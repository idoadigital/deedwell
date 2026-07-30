import type { PoolClient } from "pg";
import { uuidv7, withContext } from "@deedwell/database";
import type { Deps } from "./bootstrap.js";

/**
 * Grant application workspace layer (workspace spec §1, §4, §19).
 * Timeline events describe verifiable actions — an event is only written when
 * the underlying work actually happened (a workflow step transitioned, a
 * retrieval succeeded or failed). Never model reasoning, never fake progress.
 */

export interface WorkspaceEventInput {
  tenantId: string;
  projectId: string;
  runId?: string | null;
  eventType: string;
  title: string;
  summary?: string;
  status: "in_progress" | "completed" | "failed" | "blocked";
  agentKey?: string | null;
  artifactId?: string | null;
  metadata?: Record<string, unknown>;
  error?: string | null;
}

export async function recordEvent(client: PoolClient, e: WorkspaceEventInput): Promise<string> {
  const id = uuidv7();
  await client.query(
    `INSERT INTO workspace_events (id, tenant_id, project_id, run_id, event_type, title, summary,
       status, agent_key, artifact_id, metadata, error, completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
       CASE WHEN $8 IN ('completed','failed') THEN now() ELSE NULL END)`,
    [id, e.tenantId, e.projectId, e.runId ?? null, e.eventType, e.title, e.summary ?? "",
     e.status, e.agentKey ?? null, e.artifactId ?? null, JSON.stringify(e.metadata ?? {}),
     e.error ?? null]
  );
  return id;
}

export async function recordSource(client: PoolClient, s: {
  tenantId: string; projectId: string; url?: string | null; title: string;
  publisher?: string | null; sourceType?: string; reliability?: string;
  fetchStatus?: string; fileId?: string | null; excerpt?: string;
}): Promise<string> {
  const id = uuidv7();
  await client.query(
    `INSERT INTO research_sources (id, tenant_id, project_id, url, title, publisher,
       source_type, reliability, fetch_status, file_id, excerpt)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, s.tenantId, s.projectId, s.url ?? null, s.title, s.publisher ?? null,
     s.sourceType ?? "OFFICIAL_ANNOUNCEMENT", s.reliability ?? "PRIMARY_OFFICIAL",
     s.fetchStatus ?? "retrieved", s.fileId ?? null, (s.excerpt ?? "").slice(0, 1500)]
  );
  return id;
}

export async function setWorkspace(
  client: PoolClient,
  projectId: string,
  status: string,
  phase: string,
  pendingIntent?: Record<string, unknown> | null
): Promise<void> {
  if (pendingIntent === undefined) {
    await client.query(
      "UPDATE projects SET workspace_status = $2, workspace_phase = $3 WHERE id = $1",
      [projectId, status, phase]
    );
  } else {
    await client.query(
      "UPDATE projects SET workspace_status = $2, workspace_phase = $3, pending_intent = $4 WHERE id = $1",
      [projectId, status, phase, pendingIntent ? JSON.stringify(pendingIntent) : null]
    );
  }
}

// ---------------------------------------------------------------------------
// Engine step → timeline bridge. Each event corresponds to a REAL workflow
// step transition persisted by the durable engine (survives restarts).
// ---------------------------------------------------------------------------

/** Honest descriptions of what each grant workflow step actually does. */
const STEP_EVENTS: Record<string, { title: string; summary: string; agent: string }> = {
  parse_document: {
    title: "Parsing the announcement document",
    summary: "Extracted the text of the funding announcement and scanned it for prompt-injection content.",
    agent: "grant.requirements_analyst",
  },
  extract_requirements: {
    title: "Extracting requirements",
    summary: "Read the announcement and built the compliance matrix with every application requirement, each linked to its source line.",
    agent: "grant.requirements_analyst",
  },
  eligibility_check: {
    title: "Checking eligibility",
    summary: "Compared the announcement's eligibility rules against your organization's certified facts.",
    agent: "grant.eligibility_analyst",
  },
  bid_no_bid: {
    title: "Scoring the bid assessment",
    summary: "Scored fit across eligibility, alignment, capacity, and deadline to recommend pursue or pass.",
    agent: "grant.funding_strategist",
  },
  bid_gate: {
    title: "Waiting for your go/no-go decision",
    summary: "The pursue-or-pass decision is yours; the team is paused until you decide.",
    agent: "grant.funding_strategist",
  },
  plan_application: {
    title: "Planning the application",
    summary: "Mapped every mandatory requirement to a planned section with owners.",
    agent: "grant.writer",
  },
  draft_sections: {
    title: "Drafting narrative sections",
    summary: "Wrote each planned section from certified organizational facts; unsupported claims are flagged, not invented.",
    agent: "grant.writer",
  },
  build_budget: {
    title: "Building the budget",
    summary: "Produced the line-item budget with justifications.",
    agent: "grant.budget_specialist",
  },
  build_logic_model: {
    title: "Building the logic model",
    summary: "Connected activities to outputs and outcomes for the evaluation section.",
    agent: "grant.mel_specialist",
  },
  review_panel: {
    title: "Running the internal review panel",
    summary: "A reviewer panel scored the draft against the announcement's evaluation criteria.",
    agent: "grant.reviewer_panel",
  },
  final_compliance: {
    title: "Running the final compliance check",
    summary: "Verified mandatory requirements, claims support, budget math, and the deadline.",
    agent: "grant.compliance_reviewer",
  },
  final_gate: {
    title: "Waiting for your export approval",
    summary: "The reviewed package is ready; export happens only after your approval.",
    agent: "grant.reviewer_panel",
  },
  export_full: {
    title: "Exporting the application package",
    summary: "Rendered the full application (markdown + budget CSV) into downloadable files.",
    agent: "grant.writer",
  },
};

/** Map workflow step to a coarse workspace phase for the Overview tab. */
export function phaseForStep(step: string): string {
  if (["parse_document", "extract_requirements"].includes(step)) return "Analyzing requirements";
  if (["eligibility_check"].includes(step)) return "Checking eligibility";
  if (["bid_no_bid", "bid_gate"].includes(step)) return "Bid decision";
  if (["plan_application", "draft_sections", "build_budget", "build_logic_model"].includes(step)) return "Drafting";
  if (["review_panel", "final_compliance"].includes(step)) return "Internal review";
  if (["final_gate"].includes(step)) return "Ready for your review";
  if (["export_full"].includes(step)) return "Final package";
  return step.replace(/_/g, " ");
}

const STEP_ORDER = Object.keys(STEP_EVENTS);

/** Requirement-derived completion: fraction of REAL persisted steps done. */
export function completionForRun(currentStep: string, status: string): number {
  if (status === "completed") return 100;
  const idx = STEP_ORDER.indexOf(currentStep);
  if (idx < 0) return 5;
  return Math.min(95, Math.round(5 + (idx / STEP_ORDER.length) * 90));
}

const inflightW = new Set<Promise<void>>();

/**
 * Records a timeline event for each grant-workflow step transition the durable
 * engine persists. Dedupe: one event per (run, step) — refreshes and worker
 * retries do not create duplicates.
 */
export function attachWorkspaceBridge(deps: Deps): void {
  deps.engine.events.on("event", (event: { type: string; tenantId: string; runId: string; status: string; step: string }) => {
    if (event.type !== "run_updated") return;
    const p = stepEvent(deps, event).catch(() => undefined).then(() => { inflightW.delete(p); });
    inflightW.add(p);
  });
}

/** Tests await this after engine.drain() so timeline rows are visible. */
export async function workspaceBridgeFlush(): Promise<void> {
  while (inflightW.size) await Promise.all([...inflightW]);
}

async function stepEvent(
  deps: Deps,
  event: { tenantId: string; runId: string; status: string; step: string }
): Promise<void> {
  const known = STEP_EVENTS[event.step];
  await withContext(deps.appPool, { tenantId: event.tenantId, userId: null }, async (client) => {
    const run = await client.query(
      "SELECT project_id, definition, last_error FROM workflow_runs WHERE id = $1",
      [event.runId]
    );
    if (!run.rows[0] || !String(run.rows[0].definition).startsWith("grant")) return;
    const projectId = run.rows[0].project_id;

    if (event.status === "failed") {
      await recordEvent(client, {
        tenantId: event.tenantId, projectId, runId: event.runId,
        eventType: "step_failed", status: "failed",
        title: `${known?.title ?? event.step.replace(/_/g, " ")} — failed`,
        summary: "The step stopped after several attempts. Completed work is preserved; the run can be resumed once the cause is fixed.",
        error: String(run.rows[0].last_error ?? "").slice(0, 400) || null,
        agentKey: known?.agent ?? null,
      });
      await setWorkspace(client, projectId, "blocked", "Needs attention");
      return;
    }
    // The engine emits the step now CURRENT — so arriving at step X means the
    // previous step finished. Close out any open step events for this run.
    await client.query(
      `UPDATE workspace_events SET status = 'completed', completed_at = now()
       WHERE run_id = $1 AND status IN ('in_progress','blocked') AND event_type LIKE 'step:%'
         AND event_type <> $2`,
      [event.runId, `step:${event.step}`]
    );
    if (event.status === "completed") {
      await client.query(
        `UPDATE workspace_events SET status = 'completed', completed_at = now()
         WHERE run_id = $1 AND status IN ('in_progress','blocked') AND event_type LIKE 'step:%'`,
        [event.runId]
      );
    }
    if (!known) return;
    // One event per (run, step): the engine may re-emit on lease renewals.
    const dup = await client.query(
      `SELECT 1 FROM workspace_events WHERE run_id = $1 AND event_type = $2 LIMIT 1`,
      [event.runId, `step:${event.step}`]
    );
    if (!dup.rows[0] && event.status !== "completed") {
      await recordEvent(client, {
        tenantId: event.tenantId, projectId, runId: event.runId,
        eventType: `step:${event.step}`,
        title: known.title, summary: known.summary,
        status: event.status === "waiting_for_info" || event.status === "waiting_approval" ? "blocked" : "in_progress",
        agentKey: known.agent,
      });
    } else if (dup.rows[0] && (event.status === "waiting_for_info" || event.status === "waiting_approval")) {
      await client.query(
        `UPDATE workspace_events SET status = 'blocked' WHERE run_id = $1 AND event_type = $2`,
        [event.runId, `step:${event.step}`]
      );
    }
    const status = event.status === "completed" ? "completed"
      : event.status === "waiting_for_info" ? "waiting_for_user"
      : event.status === "waiting_approval" ? "waiting_for_user"
      : "in_progress";
    await setWorkspace(client, projectId, status, event.status === "completed" ? "Complete" : phaseForStep(event.step));
  });
}
