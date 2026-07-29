import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, createTestEnv, startSlice, type TestEnv } from "../helpers.js";

/**
 * The Phase 2 vertical slice, end to end over HTTP:
 * upload → extract requirements → request missing info → compliance matrix →
 * draft with claim flagging → approval gate → export. BRD §23 acceptance rows.
 */

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.close();
});

describe("grant vertical slice — happy path", () => {
  let s: Awaited<ReturnType<typeof startSlice>>;

  it("starts a run and pauses to request missing organization facts", async () => {
    s = await startSlice(env, "hopeful-futures");
    await env.deps.engine.drain("test-worker");

    const run = await api(env.app, "GET", `/v1/orgs/${s.orgId}/runs/${s.runId}`, { token: s.token });
    expect(run.status).toBe(200);
    expect(run.body.run.status).toBe("waiting_for_info");
    const missing = run.body.run.waiting.payload;
    expect(missing).toContain("legal_name");
    expect(missing).toContain("registration_status");

    // Requirements were extracted with source locations before the pause.
    const matrix = run.body.artifacts.find((a: any) => a.type === "compliance_matrix");
    expect(matrix).toBeTruthy();
    const artifact = await api(env.app, "GET", `/v1/orgs/${s.orgId}/artifacts/${matrix.id}`, {
      token: s.token,
    });
    const reqs = artifact.body.versions[0].content.requirements;
    expect(reqs.length).toBeGreaterThanOrEqual(5);
    expect(reqs.every((r: any) => r.sourceLocation?.line > 0 && r.sourceLocation?.quote)).toBe(true);
    expect(reqs.some((r: any) => r.mandatory)).toBe(true);
    expect(reqs.some((r: any) => !r.mandatory)).toBe(true);
  });

  it("resumes after facts are provided and pauses at the approval gate", async () => {
    const res = await api(env.app, "POST", `/v1/orgs/${s.orgId}/runs/${s.runId}/provide-info`, {
      token: s.token,
      body: {
        facts: [
          { key: "legal_name", value: "Hopeful Futures Inc." },
          { key: "entity_type", value: "501(c)(3) nonprofit corporation" },
          { key: "registration_status", value: "Registered in Ohio since 2015" },
          { key: "annual_budget", value: "$420,000 (FY2025)" },
          { key: "mission", value: "Mentoring and after-school programs for youth" },
        ],
      },
    });
    expect(res.status).toBe(200);
    await env.deps.engine.drain("test-worker");

    const run = await api(env.app, "GET", `/v1/orgs/${s.orgId}/runs/${s.runId}`, { token: s.token });
    expect(run.body.run.status).toBe("waiting_approval");
    expect(run.body.approvals.length).toBe(1);
    expect(run.body.approvals[0].status).toBe("pending");

    // The drafted section flags its unsupported claim instead of hiding it.
    const section = run.body.artifacts.find((a: any) => a.type === "grant_section");
    const artifact = await api(env.app, "GET", `/v1/orgs/${s.orgId}/artifacts/${section.id}`, {
      token: s.token,
    });
    const content = artifact.body.versions[0].content;
    expect(content.claims.some((c: any) => c.flagged && c.support === "unsupported")).toBe(true);
    expect(content.claims.some((c: any) => !c.flagged)).toBe(true);
    expect(content.warnings.join(" ")).toContain("claim(s) lack verified");
  });

  it("does not export before approval (threat T5)", async () => {
    const run = await api(env.app, "GET", `/v1/orgs/${s.orgId}/runs/${s.runId}`, { token: s.token });
    expect(run.body.artifacts.some((a: any) => a.type === "export_package")).toBe(false);
  });

  it("exports after approval, with the funding disclaimer and evidence review", async () => {
    const run = await api(env.app, "GET", `/v1/orgs/${s.orgId}/runs/${s.runId}`, { token: s.token });
    const approvalId = run.body.approvals[0].id;
    const decided = await api(env.app, "POST", `/v1/orgs/${s.orgId}/approvals/${approvalId}`, {
      token: s.token,
      body: { decision: "approved", note: "Looks good — proceed." },
    });
    expect(decided.status).toBe(200);
    await env.deps.engine.drain("test-worker");

    const after = await api(env.app, "GET", `/v1/orgs/${s.orgId}/runs/${s.runId}`, { token: s.token });
    expect(after.body.run.status).toBe("completed");
    const exportArtifact = after.body.artifacts.find((a: any) => a.type === "export_package");
    expect(exportArtifact).toBeTruthy();

    const md = await api(env.app, "GET",
      `/v1/orgs/${s.orgId}/artifacts/${exportArtifact.id}/export`, { token: s.token });
    expect(md.status).toBe(200);
    expect(md.raw).toContain("does not and cannot guarantee a grant award");
    expect(md.raw).toContain("Compliance Matrix");
    expect(md.raw).toContain("claim(s) lack verified or user-certified evidence");
    expect(md.raw).toContain("500");
  });

  it("recorded audit events, tool invocations, and model usage for the run", async () => {
    const { rows: auditRows } = await env.adminPool.query(
      "SELECT action FROM audit_events WHERE tenant_id = $1 ORDER BY seq", [s.orgId]
    );
    const actions = auditRows.map((r) => r.action);
    for (const expected of [
      "org.created", "project.created", "file.uploaded", "workflow.started",
      "artifact.version_created", "approval.requested", "workflow.info_provided",
      "approval.approved", "export.completed",
    ]) {
      expect(actions).toContain(expected);
    }

    const { rows: tools } = await env.adminPool.query(
      "SELECT tool, agent_key, ok FROM tool_invocations WHERE tenant_id = $1", [s.orgId]
    );
    expect(tools.some((t) => t.tool === "record_requirements" && t.ok)).toBe(true);
    expect(tools.every((t) => t.agent_key)).toBe(true);

    const { rows: usage } = await env.adminPool.query(
      "SELECT kind, SUM(quantity)::float AS q FROM usage_ledger WHERE tenant_id = $1 GROUP BY kind",
      [s.orgId]
    );
    expect(usage.find((u) => u.kind === "model_tokens")?.q).toBeGreaterThan(0);
    expect(usage.find((u) => u.kind === "steps")?.q).toBeGreaterThanOrEqual(5);
  });

  it("audit chain is hash-linked (tamper evidence)", async () => {
    const { rows } = await env.adminPool.query(
      "SELECT prev_hash, event_hash FROM audit_events WHERE tenant_id = $1 ORDER BY seq", [s.orgId]
    );
    expect(rows[0]!.prev_hash).toBe("genesis");
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.prev_hash).toBe(rows[i - 1]!.event_hash);
    }
  });
});

describe("grant vertical slice — rejection loop", () => {
  it("a rejected approval sends the run back to drafting and a new approval is created", async () => {
    const s = await startSlice(env, "second-chance");
    // Provide facts up front so the run goes straight to the approval gate.
    await api(env.app, "POST", `/v1/orgs/${s.orgId}/facts`, {
      token: s.token,
      body: {
        facts: [
          { key: "legal_name", value: "Second Chance Alliance" },
          { key: "entity_type", value: "501(c)(3)" },
          { key: "registration_status", value: "Registered" },
          { key: "annual_budget", value: "$1M" },
          { key: "mission", value: "Reentry support" },
        ],
      },
    });
    await env.deps.engine.drain("test-worker");

    let run = await api(env.app, "GET", `/v1/orgs/${s.orgId}/runs/${s.runId}`, { token: s.token });
    expect(run.body.run.status).toBe("waiting_approval");

    const firstApproval = run.body.approvals[0].id;
    await api(env.app, "POST", `/v1/orgs/${s.orgId}/approvals/${firstApproval}`, {
      token: s.token,
      body: { decision: "rejected", note: "Tone is off — redraft." },
    });
    await env.deps.engine.drain("test-worker");

    run = await api(env.app, "GET", `/v1/orgs/${s.orgId}/runs/${s.runId}`, { token: s.token });
    expect(run.body.run.status).toBe("waiting_approval");
    expect(run.body.approvals.length).toBe(2);
    expect(run.body.approvals.filter((a: any) => a.status === "pending").length).toBe(1);
    expect(run.body.artifacts.some((a: any) => a.type === "export_package")).toBe(false);

    // The section artifact now has two versions — visible history.
    const section = run.body.artifacts.find((a: any) => a.type === "grant_section");
    const artifact = await api(env.app, "GET", `/v1/orgs/${s.orgId}/artifacts/${section.id}`, {
      token: s.token,
    });
    expect(artifact.body.versions.length).toBe(2);
  });
});
