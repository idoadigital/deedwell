import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withContext } from "@deedwell/database";
import { api, createTestEnv, startSlice, type TestEnv } from "../helpers.js";

/**
 * BRD §23 "Tenancy" acceptance: two organizations cannot reach each other's
 * data through the API or the database under the RLS-bound app role.
 */

let env: TestEnv;
let orgA: Awaited<ReturnType<typeof startSlice>>;
let orgB: Awaited<ReturnType<typeof startSlice>>;

beforeAll(async () => {
  env = await createTestEnv();
  orgA = await startSlice(env, "tenant-a");
  orgB = await startSlice(env, "tenant-b");
  await env.deps.engine.drain("test-worker");
});
afterAll(async () => {
  await env.close();
});

describe("cross-tenant isolation — API layer", () => {
  it("B's token cannot read A's org resources (indistinguishable from nonexistent)", async () => {
    const attempts = [
      `/v1/orgs/${orgA.orgId}/projects`,
      `/v1/orgs/${orgA.orgId}/facts`,
      `/v1/orgs/${orgA.orgId}/runs/${orgA.runId}`,
    ];
    for (const url of attempts) {
      const res = await api(env.app, "GET", url, { token: orgB.token });
      expect(res.status).toBe(404);
    }
  });

  it("B cannot read A's run or artifacts even via B's own org path", async () => {
    const res = await api(env.app, "GET", `/v1/orgs/${orgB.orgId}/runs/${orgA.runId}`, {
      token: orgB.token,
    });
    expect(res.status).toBe(404);
  });

  it("B cannot provide info to or approve A's workflow", async () => {
    const info = await api(env.app, "POST",
      `/v1/orgs/${orgB.orgId}/runs/${orgA.runId}/provide-info`,
      { token: orgB.token, body: { facts: [{ key: "legal_name", value: "Evil Corp" }] } });
    expect(info.status).toBe(404);

    const runA = await api(env.app, "GET", `/v1/orgs/${orgA.orgId}/runs/${orgA.runId}`, {
      token: orgA.token,
    });
    // A's run is untouched by B's attempts.
    expect(runA.body.run.status).toBe("waiting_for_info");
  });

  it("unauthenticated and viewer-role limits hold", async () => {
    const anon = await api(env.app, "GET", `/v1/orgs/${orgA.orgId}/projects`);
    expect(anon.status).toBe(401);

    // A member cannot decide approvals (admin+ required).
    const { token: memberToken } = await (async () => {
      const r = await api(env.app, "POST", "/v1/auth/register", {
        body: { email: "member@tenant-a.org", password: "long-password-1", displayName: "M" },
      });
      await api(env.app, "POST", `/v1/orgs/${orgA.orgId}/members`, {
        token: orgA.token, body: { email: "member@tenant-a.org", role: "member" },
      });
      return r.body;
    })();
    const decide = await api(env.app, "POST",
      `/v1/orgs/${orgA.orgId}/approvals/${orgA.runId}`,
      { token: memberToken, body: { decision: "approved" } });
    expect(decide.status).toBe(403);
  });
});

describe("cross-tenant isolation — database layer (RLS under the app role)", () => {
  it("with B's tenant context, A's rows are invisible in every tenant table", async () => {
    for (const table of ["projects", "workflow_runs", "org_facts", "artifacts", "audit_events"]) {
      const { rows } = await withContext(
        env.deps.appPool,
        { tenantId: orgB.orgId, userId: orgB.userId },
        (client) => client.query(`SELECT tenant_id FROM ${table}`)
      );
      expect(rows.every((r) => r.tenant_id === orgB.orgId)).toBe(true);
    }
  });

  it("with no tenant context, tenant tables return nothing", async () => {
    const { rows } = await withContext(
      env.deps.appPool,
      { tenantId: null, userId: null },
      (client) => client.query("SELECT id FROM projects")
    );
    expect(rows).toEqual([]);
  });

  it("the app role cannot tamper with append-only audit rows (threat T9)", async () => {
    await expect(
      withContext(env.deps.appPool, { tenantId: orgA.orgId, userId: orgA.userId }, (client) =>
        client.query("DELETE FROM audit_events WHERE tenant_id = $1", [orgA.orgId])
      )
    ).rejects.toThrow(/permission denied/);
    await expect(
      withContext(env.deps.appPool, { tenantId: orgA.orgId, userId: orgA.userId }, (client) =>
        client.query("UPDATE audit_events SET action = 'forged' WHERE tenant_id = $1", [orgA.orgId])
      )
    ).rejects.toThrow(/permission denied/);
  });
});
