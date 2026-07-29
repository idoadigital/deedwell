import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgWorkflowEngine } from "@deedwell/workflows";
import { buildGrantSliceWorkflow, type GrantServices } from "@deedwell/grant-domain";
import { api, createTestEnv, startSlice, type TestEnv } from "../helpers.js";

/**
 * BRD §23 "Agent Harness" acceptance: a workflow survives a worker restart,
 * failed steps retry safely without duplicating effects, and budget overruns
 * suspend the run.
 */

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.close();
});

describe("workflow durability", () => {
  it("survives a worker restart mid-run without duplicating work", async () => {
    const s = await startSlice(env, "resilient-org");

    // Worker A executes only the first step, then "dies".
    await env.deps.engine.runPendingOnce("worker-A");

    // A brand-new engine instance (fresh process semantics — state only in
    // Postgres) picks the run up and continues.
    const engineB = new PgWorkflowEngine<GrantServices>(
      env.deps.adminPool,
      env.deps.appPool,
      { provider: env.deps.provider, gateway: env.deps.gateway, storage: env.deps.storage },
      () => 0
    );
    engineB.register(buildGrantSliceWorkflow());
    await engineB.drain("worker-B");

    const run = await api(env.app, "GET", `/v1/orgs/${s.orgId}/runs/${s.runId}`, { token: s.token });
    expect(run.body.run.status).toBe("waiting_for_info");

    // No duplicated side effects: one requirement row per source line, one
    // matrix artifact with exactly one version.
    const { rows: dupes } = await env.adminPool.query(
      `SELECT opportunity_id, source_line, md5(text), COUNT(*)
       FROM grant_requirements WHERE tenant_id = $1
       GROUP BY 1,2,3 HAVING COUNT(*) > 1`,
      [s.orgId]
    );
    expect(dupes).toEqual([]);
    const { rows: versions } = await env.adminPool.query(
      `SELECT a.type, COUNT(v.id)::int AS versions FROM artifacts a
       JOIN artifact_versions v ON v.artifact_id = a.id
       WHERE a.tenant_id = $1 GROUP BY a.type`,
      [s.orgId]
    );
    expect(versions.find((v) => v.type === "compliance_matrix")?.versions).toBe(1);
  });

  it("bounded retries: a failing step retries then fails the run resumably", async () => {
    const s = await startSlice(env, "unlucky-org");
    // Sabotage: point the file at a storage key that doesn't exist so
    // parse_document keeps failing.
    await env.adminPool.query(
      "UPDATE files SET storage_key = 'tenants/broken/missing/opportunity.txt' WHERE tenant_id = $1",
      [s.orgId]
    );

    await env.deps.engine.drain("test-worker");

    const run = await api(env.app, "GET", `/v1/orgs/${s.orgId}/runs/${s.runId}`, { token: s.token });
    expect(run.body.run.status).toBe("failed");
    expect(run.body.run.last_error).toMatch(/ENOENT|no such file/);
    // The journal shows each bounded attempt — visible failure, not silence.
    const failedAttempts = run.body.steps.filter((st: any) => st.status === "failed");
    expect(failedAttempts.length).toBe(3);
  });

  it("suspends a run that exhausts its step budget instead of looping forever", async () => {
    const s = await startSlice(env, "budget-org");
    await env.adminPool.query(
      "UPDATE workflow_runs SET step_budget = 1 WHERE id = $1", [s.runId]
    );
    await env.deps.engine.drain("test-worker");

    const run = await api(env.app, "GET", `/v1/orgs/${s.orgId}/runs/${s.runId}`, { token: s.token });
    expect(run.body.run.status).toBe("suspended_budget");
    expect(run.body.run.last_error).toContain("budget");
  });
});
