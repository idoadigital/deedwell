import type { PoolClient } from "pg";
import { audit, uuidv7, withContext } from "@deedwell/database";
import { runAgentTask } from "@deedwell/agent-runtime";
import { AgentDefinition, IntentOutput, type OrgFact } from "@deedwell/schemas";
import { GRANT_FULL_WORKFLOW } from "@deedwell/grant-domain";
import { WEBSITE_BUILD_WORKFLOW, WEBSITE_UPDATE_WORKFLOW } from "@deedwell/website-domain";
import type { Deps } from "./bootstrap.js";
import { DEFAULT_CHANNELS, MAYA_WELCOME, TEAMMATES } from "./teammates.js";

/**
 * The Executive Assistant: conversational entry point (BRD §4.1). It maps a
 * user's message to ONE typed intent (model-routed; rule-based under the mock
 * provider) — execution is always deterministic server code below, and every
 * consequential step still runs through workflows and approval gates.
 */
export const executiveAssistant: AgentDefinition = AgentDefinition.parse({
  agentKey: "core.executive_assistant",
  version: 1,
  displayName: "Maya — Executive Assistant",
  team: "core",
  role: "Executive Assistant: conversational entry point, routes work to the right team",
  instructions: `You are Maya, the Executive Assistant of the user's AI team at Deedwell,
a workspace for nonprofit organizations. Read the user's message and the workspace context,
then choose exactly one action. Never invent search results, approvals, or organizational
facts. When the team is waiting for information, map the user's reply onto the requested
fact keys. Prefer "clarify" over guessing when a request is ambiguous or destructive.`,
  allowedTools: [],
  outputSchemaRef: "intent",
  maxOutputRetries: 2,
});

// ---------------------------------------------------------------------------
// Channels & messages
// ---------------------------------------------------------------------------

export interface ChannelRow {
  id: string;
  key: string;
  name: string;
  kind: "team" | "project" | "dm";
  project_id: string | null;
  project_type?: string | null;
  agent_key?: string | null;
}

export function channelSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "project";
}

export async function ensureChannels(client: PoolClient, tenantId: string): Promise<void> {
  for (const ch of DEFAULT_CHANNELS) {
    await client.query(
      `INSERT INTO channels (id, tenant_id, key, name, kind)
       VALUES ($1,$2,$3,$4,'team') ON CONFLICT (tenant_id, key) DO NOTHING`,
      [uuidv7(), tenantId, ch.key, ch.name]
    );
  }
  // Teammates are present from workspace creation — one DM conversation each.
  for (const mate of TEAMMATES) {
    await client.query(
      `INSERT INTO channels (id, tenant_id, key, name, kind, agent_key)
       VALUES ($1,$2,$3,$4,'dm',$5) ON CONFLICT (tenant_id, key) DO NOTHING`,
      [uuidv7(), tenantId, `dm:${mate.agentKey}`, mate.name, mate.agentKey]
    );
  }
  const { rows: projects } = await client.query("SELECT id, name FROM projects");
  for (const project of projects) {
    await client.query(
      `INSERT INTO channels (id, tenant_id, key, name, kind, project_id)
       VALUES ($1,$2,$3,$4,'project',$5)
       ON CONFLICT (tenant_id, key) DO NOTHING`,
      [uuidv7(), tenantId, `project:${project.id}`, channelSlug(project.name), project.id]
    );
  }
  // First-time experience: Maya greets in her DM (interface spec §11).
  const maya = await client.query(
    "SELECT id FROM channels WHERE tenant_id = $1 AND key = 'dm:core.executive_assistant'",
    [tenantId]
  );
  if (maya.rows[0]) {
    const { rows } = await client.query(
      "SELECT 1 FROM messages WHERE channel_id = $1 LIMIT 1", [maya.rows[0].id]
    );
    if (!rows[0]) {
      await insertMessage(client, {
        tenantId, channelId: maya.rows[0].id, authorKind: "agent",
        authorAgent: executiveAssistant.agentKey, body: MAYA_WELCOME,
      });
    }
  }
}

/** Create a project + its channel (projects appear as channels — spec §8). */
export async function createProjectChannel(
  client: PoolClient,
  tenantId: string,
  userId: string,
  name: string,
  type: "grant_application" | "website" | "other"
): Promise<{ projectId: string; channelId: string; channelName: string }> {
  const projectId = uuidv7();
  await client.query(
    "INSERT INTO projects (id, tenant_id, name, type, created_by) VALUES ($1,$2,$3,$4,$5)",
    [projectId, tenantId, name, type, userId]
  );
  const channelId = uuidv7();
  const channelName = channelSlug(name);
  await client.query(
    `INSERT INTO channels (id, tenant_id, key, name, kind, project_id)
     VALUES ($1,$2,$3,$4,'project',$5)`,
    [channelId, tenantId, `project:${projectId}`, channelName, projectId]
  );
  return { projectId, channelId, channelName };
}

interface PostArgs {
  tenantId: string;
  channelId: string;
  authorKind: "user" | "agent" | "system";
  authorUser?: string | null;
  authorAgent?: string | null;
  body: string;
  metadata?: Record<string, unknown>;
}

export async function insertMessage(client: PoolClient, args: PostArgs): Promise<Record<string, unknown>> {
  const id = uuidv7();
  await client.query(
    `INSERT INTO messages (id, tenant_id, channel_id, author_kind, author_user, author_agent, body, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, args.tenantId, args.channelId, args.authorKind, args.authorUser ?? null,
     args.authorAgent ?? null, args.body, JSON.stringify(args.metadata ?? {})]
  );
  return {
    id, channel_id: args.channelId, author_kind: args.authorKind,
    author_user: args.authorUser ?? null, author_agent: args.authorAgent ?? null,
    body: args.body, metadata: args.metadata ?? {}, created_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Context for intent routing
// ---------------------------------------------------------------------------

async function buildContext(client: PoolClient, tenantId: string, channel: ChannelRow) {
  const org = await client.query("SELECT name FROM organizations WHERE id = $1", [tenantId]);
  const recent = await client.query(
    `SELECT metadata FROM messages WHERE channel_id = $1 ORDER BY created_at DESC LIMIT 40`,
    [channel.id]
  );
  let lastSearchResults: Array<{ index: number; title: string }> = [];
  let lastUploadedFileId: string | null = null;
  for (const row of recent.rows) {
    const meta = row.metadata as { searchResults?: Array<{ index: number; title: string }>; fileId?: string };
    if (!lastSearchResults.length && meta.searchResults?.length) lastSearchResults = meta.searchResults;
    if (!lastUploadedFileId && meta.fileId) lastUploadedFileId = meta.fileId;
  }
  const approvals = await client.query(
    `SELECT a.id, a.kind FROM approvals a JOIN workflow_runs r ON r.id = a.run_id
     WHERE a.status = 'pending' ${channel.project_id ? "AND r.project_id = $1" : ""}
     ORDER BY a.created_at DESC LIMIT 5`,
    channel.project_id ? [channel.project_id] : []
  );
  const waiting = await client.query(
    `SELECT id, status, state->'waiting'->>'payload' AS payload FROM workflow_runs
     WHERE status = 'waiting_for_info' ${channel.project_id ? "AND project_id = $1" : ""}
     ORDER BY updated_at DESC LIMIT 5`,
    channel.project_id ? [channel.project_id] : []
  );
  const sites = await client.query("SELECT id FROM sites LIMIT 1");
  return {
    orgName: org.rows[0]?.name ?? "",
    channelKind: channel.kind,
    projectType: channel.project_type ?? null,
    lastSearchResults,
    lastUploadedFileId,
    pendingApprovals: approvals.rows,
    waitingRuns: waiting.rows.map((r) => {
      let missingFacts: string[] = [];
      try {
        missingFacts = (JSON.parse(r.payload ?? "{}") as { missingFacts?: string[] }).missingFacts ?? [];
      } catch { /* keep empty */ }
      return { id: r.id, status: r.status, missingFacts };
    }),
    hasSite: sites.rows.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Handling a user message
// ---------------------------------------------------------------------------

const EA = executiveAssistant.displayName;

export async function handleUserMessage(
  deps: Deps,
  client: PoolClient,
  ids: { tenantId: string; userId: string },
  channel: ChannelRow,
  body: string,
  fileId: string | null,
  clientKey?: string | null
): Promise<Array<Record<string, unknown>>> {
  if (clientKey) {
    const dup = await client.query(
      `SELECT 1 FROM messages WHERE channel_id = $1 AND metadata->>'clientKey' = $2 LIMIT 1`,
      [channel.id, clientKey]
    );
    if (dup.rows[0]) return []; // idempotent resend — already handled
  }
  const out: Array<Record<string, unknown>> = [];
  // In a DM, the teammate you're talking to answers; elsewhere Maya coordinates.
  const persona = channel.kind === "dm" && channel.agent_key ? channel.agent_key : executiveAssistant.agentKey;
  const say = async (text: string, metadata: Record<string, unknown> = {}, agent = persona) => {
    out.push(await insertMessage(client, {
      tenantId: ids.tenantId, channelId: channel.id, authorKind: "agent",
      authorAgent: agent, body: text, metadata,
    }));
  };

  out.push(await insertMessage(client, {
    tenantId: ids.tenantId, channelId: channel.id, authorKind: "user",
    authorUser: ids.userId, body,
    metadata: { ...(fileId ? { fileId } : {}), ...(clientKey ? { clientKey } : {}) },
  }));

  const context = await buildContext(client, ids.tenantId, channel);
  if (fileId) context.lastUploadedFileId = fileId;

  let intent: IntentOutput;
  try {
    const result = await runAgentTask<IntentOutput>(
      deps.provider, executiveAssistant,
      "Choose the single best action for the user's message.",
      [
        { label: "user_message", content: body },
        { label: "context", content: JSON.stringify(context) },
      ]
    );
    intent = result.output;
  } catch (err) {
    await say(
      `I hit a problem understanding that (${err instanceof Error ? err.message.slice(0, 120) : "routing error"}). Could you rephrase?`
    );
    return out;
  }

  switch (intent.action) {
    case "answer":
      await say(intent.text);
      break;
    case "clarify":
      await say(intent.question);
      break;

    case "search_grants": {
      try {
        const results = await deps.grantSource.search(intent.keyword, 8);
        if (!results.length) {
          await say(`I searched ${sourceLabel(deps)} for "${intent.keyword}" and found nothing currently posted. Try a broader phrase?`);
          break;
        }
        const list = results.map((r, i) => ({
          index: i + 1, title: r.title, funder: r.agency, number: r.opportunityNumber,
          closeDate: r.closeDate, sourceUrl: r.sourceUrl,
        }));
        await say(
          `Here's what ${sourceLabel(deps)} has for "${intent.keyword}". Attach the announcement document and say "apply for #N" — I'll set up a channel for the application and bring the team in:`,
          { searchResults: list },
          channel.agent_key === "grant.funding_strategist" ? channel.agent_key : "grant.opportunity_researcher"
        );
      } catch (err) {
        await say(`The grant source is unavailable right now (${err instanceof Error ? err.message.slice(0, 100) : "error"}). No results were fabricated — try again shortly.`);
      }
      break;
    }

    case "start_grant_application": {
      const pick = context.lastSearchResults.find((r) => r.index === intent.resultIndex) as
        | { index: number; title: string; funder?: string; number?: string; closeDate?: string | null; sourceUrl?: string }
        | undefined;
      if (!pick) {
        await say(`I don't see a result #${intent.resultIndex} in this conversation's recent search. Run a search first ("find grants for …").`);
        break;
      }
      if (!context.lastUploadedFileId) {
        await say(`To start on "${pick.title}" I need the announcement document — attach the .txt/.md file here and then say "apply for #${intent.resultIndex}" again. I won't guess at requirements I haven't read.`);
        break;
      }
      // The project lives in its own channel (spec §7): reuse this one if it's
      // a project channel, otherwise create #<grant-name> and bring the team in.
      let projectId = channel.project_id;
      let targetChannelId = channel.id;
      let createdChannelName: string | null = null;
      if (channel.kind !== "project") {
        const created = await createProjectChannel(
          client, ids.tenantId, ids.userId, pick.title.slice(0, 80), "grant_application"
        );
        projectId = created.projectId;
        targetChannelId = created.channelId;
        createdChannelName = created.channelName;
      }
      const opportunityId = uuidv7();
      await client.query(
        `INSERT INTO grant_opportunities (id, tenant_id, project_id, title, funder, source,
           opportunity_number, agency, deadline, source_url, file_id)
         VALUES ($1,$2,$3,$4,$5,'grants_gov',$6,$5,$7,$8,$9)`,
        [opportunityId, ids.tenantId, projectId, pick.title, pick.funder ?? "Unknown funder",
         pick.number ?? null, pick.closeDate ?? null,
         pick.sourceUrl?.startsWith("http") ? pick.sourceUrl : null, context.lastUploadedFileId]
      );
      const runId = await deps.engine.start(client, {
        tenantId: ids.tenantId, projectId: projectId!, definition: GRANT_FULL_WORKFLOW,
        createdBy: ids.userId,
        input: { opportunityId, fileId: context.lastUploadedFileId },
      });
      await audit(client, {
        tenantId: ids.tenantId, actorUser: ids.userId, actorAgent: executiveAssistant.agentKey,
        action: "workflow.started", entityType: "workflow_run", entityId: runId,
        metadata: { via: "chat", opportunityId },
      });
      const kickoff = `Hi team! I'm kicking off our application for the ${pick.title} grant.\n\n📋 Collecting program requirements and application guidelines\n🔍 Checking eligibility for your organization\n👥 Assigning the right teammates to each section\n\nI'll keep everyone updated as we move forward. Let me know if there's anything I should add to our requirements list!`;
      if (createdChannelName) {
        await insertMessage(client, {
          tenantId: ids.tenantId, channelId: targetChannelId, authorKind: "agent",
          authorAgent: executiveAssistant.agentKey, body: kickoff, metadata: { runId },
        });
        await say(`I've set up #${createdChannelName} for this application and brought the grant team in — the work continues there.`, { goToChannelId: targetChannelId, runId });
      } else {
        await say(kickoff, { runId });
      }
      break;
    }

    case "build_website": {
      let projectId = channel.project_id;
      let siteChannelName: string | null = null;
      let siteChannelId = channel.id;
      if (!projectId) {
        const created = await createProjectChannel(
          client, ids.tenantId, ids.userId, "Website Launch", "website"
        );
        projectId = created.projectId;
        siteChannelName = created.channelName;
        siteChannelId = created.channelId;
      }
      const orgSlugRow = await client.query("SELECT slug, name FROM organizations WHERE id = $1", [ids.tenantId]);
      const baseSlug: string = orgSlugRow.rows[0].slug;
      const siteName: string = intent.siteName ?? orgSlugRow.rows[0].name;
      const siteId = uuidv7();
      let slug = baseSlug;
      for (const candidate of [baseSlug, `${baseSlug}-site`, `${baseSlug}-${siteId.slice(0, 4)}`]) {
        const taken = await client.query("SELECT 1 FROM sites WHERE slug = $1", [candidate]);
        if (!taken.rows[0]) { slug = candidate; break; }
      }
      await client.query(
        `INSERT INTO sites (id, tenant_id, project_id, slug, name, theme, created_by)
         VALUES ($1,$2,$3,$4,$5,'{"palette":"slate","headingFont":"serif"}',$6)`,
        [siteId, ids.tenantId, projectId, slug, siteName, ids.userId]
      );
      const runId = await deps.engine.start(client, {
        tenantId: ids.tenantId, projectId, definition: WEBSITE_BUILD_WORKFLOW, createdBy: ids.userId,
        input: { siteId, siteName, donateUrl: null },
      });
      const kickoff = `The Website Team is on it — Ava is drafting the brief and Emma will write the pages from your approved organizational facts. Your address will be ${slug}.deedwell.app; you'll get a preview to approve before anything goes live.`;
      if (siteChannelName) {
        await insertMessage(client, {
          tenantId: ids.tenantId, channelId: siteChannelId, authorKind: "agent",
          authorAgent: "website.digital_strategist", body: kickoff, metadata: { runId, siteId },
        });
        await say(`I've created #${siteChannelName} and brought the Website Team in — follow the build there.`, { goToChannelId: siteChannelId, runId });
      } else {
        await say(kickoff, { runId, siteId }, "website.digital_strategist");
      }
      break;
    }

    case "update_website": {
      const site = await client.query(
        `SELECT id, project_id FROM sites ${channel.project_id ? "WHERE project_id = $1" : ""} ORDER BY created_at DESC LIMIT 1`,
        channel.project_id ? [channel.project_id] : []
      );
      if (!site.rows[0]) {
        await say(`There's no website yet — say "build our website" and the team will create one first.`);
        break;
      }
      const runId = await deps.engine.start(client, {
        tenantId: ids.tenantId, projectId: site.rows[0].project_id,
        definition: WEBSITE_UPDATE_WORKFLOW, createdBy: ids.userId,
        input: { siteId: site.rows[0].id, instruction: intent.instruction },
      });
      await say(`Passing that to Kenji on the Website Team. If he can translate it into a change, you'll get a new preview here to approve; if not, he'll say so honestly.`, { runId });
      break;
    }

    case "provide_info": {
      const waitingRun = context.waitingRuns[0];
      if (!waitingRun) {
        await say(`Nobody on the team is waiting for information right now, so I've not recorded those values. If you want them in your Funding Passport anyway, use the Passport tool in the sidebar.`);
        break;
      }
      for (const fact of intent.facts) {
        await client.query(
          `INSERT INTO org_facts (id, tenant_id, fact_key, value, status, certified_by)
           VALUES ($1,$2,$3,$4,'user_certified',$5)
           ON CONFLICT (tenant_id, fact_key)
           DO UPDATE SET value = EXCLUDED.value, status = 'user_certified', certified_by = EXCLUDED.certified_by`,
          [uuidv7(), ids.tenantId, fact.key, fact.value, ids.userId]
        );
      }
      await deps.engine.signal(client, waitingRun.id, "info", { keys: intent.facts.map((f) => f.key) });
      await audit(client, {
        tenantId: ids.tenantId, actorUser: ids.userId, action: "workflow.info_provided",
        entityType: "workflow_run", entityId: waitingRun.id,
        metadata: { via: "chat", keys: intent.facts.map((f) => f.key) },
      });
      await say(`Recorded as user-certified facts: ${intent.facts.map((f) => f.key.replace(/_/g, " ")).join(", ")}. The team is picking the work back up.`);
      break;
    }

    case "approve":
    case "reject": {
      const target = context.pendingApprovals[0];
      if (!target) {
        await say(`There's nothing waiting for approval${channel.kind === "project" ? " in this project" : ""} right now.`);
        break;
      }
      const decision = intent.action === "approve" ? "approved" : "rejected";
      const { rows } = await client.query(
        `UPDATE approvals SET status = $2, decided_by = $3, decided_at = now(), note = $4
         WHERE id = $1 AND status = 'pending' RETURNING run_id, kind`,
        [target.id, decision, ids.userId, intent.note]
      );
      if (!rows[0]) {
        await say(`That approval was already decided — nothing changed.`);
        break;
      }
      await deps.engine.signal(client, rows[0].run_id, "approval", { approvalId: target.id, decision });
      await audit(client, {
        tenantId: ids.tenantId, actorUser: ids.userId, action: `approval.${decision}`,
        entityType: "approval", entityId: target.id, metadata: { via: "chat" },
      });
      await say(
        decision === "approved"
          ? `Approved — the team is moving ahead with ${approvalLabel(rows[0].kind)}.`
          : `Understood — ${approvalLabel(rows[0].kind)} was declined and the team has been told.`
      );
      break;
    }

    case "status": {
      const runs = await client.query(
        `SELECT r.status, r.definition, p.name FROM workflow_runs r JOIN projects p ON p.id = r.project_id
         WHERE r.status NOT IN ('completed','cancelled') ORDER BY r.updated_at DESC LIMIT 10`
      );
      const approvals = await client.query(
        `SELECT COUNT(*)::int AS n FROM approvals WHERE status = 'pending'`
      );
      if (!runs.rows.length && !approvals.rows[0].n) {
        await say(`All quiet — no workflows in flight and nothing waiting on you.`);
        break;
      }
      const lines = runs.rows.map(
        (r) => `• ${r.name}: ${String(r.status).replace(/_/g, " ")} (${r.definition.replace(/-/g, " ")})`
      );
      if (approvals.rows[0].n) lines.push(`• ${approvals.rows[0].n} approval(s) waiting for you — say "approve" or check the Approvals tool.`);
      await say(`Here's where things stand:\n${lines.join("\n")}`);
      break;
    }
  }
  return out;
}

function sourceLabel(deps: Deps): string {
  return deps.grantSource.name === "grants_gov" ? "Grants.gov" : `the ${deps.grantSource.name} source`;
}

function approvalLabel(kind: string): string {
  return kind === "bid_decision" ? "pursuing this grant"
    : kind === "final_export" ? "the final application export"
    : kind === "publish_site" ? "publishing the website"
    : kind === "section_export" ? "the section export" : kind;
}

// ---------------------------------------------------------------------------
// Engine → channel bridge: workflow milestones become team messages.
// ---------------------------------------------------------------------------

const MILESTONE_STATUSES = new Set(["waiting_for_info", "waiting_approval", "completed", "failed", "suspended_budget"]);
const inflight = new Set<Promise<void>>();

export function attachEngineBridge(deps: Deps): void {
  deps.engine.events.on("event", (event: { type: string; tenantId: string; runId: string; status: string; step: string }) => {
    if (event.type !== "run_updated" || !MILESTONE_STATUSES.has(event.status)) return;
    const p = bridgeMessage(deps, event).catch(() => undefined).then(() => { inflight.delete(p); });
    inflight.add(p);
  });
}

/** Tests await this so bridge messages are visible after engine.drain(). */
export async function bridgeFlush(): Promise<void> {
  while (inflight.size) await Promise.all([...inflight]);
}

async function bridgeMessage(
  deps: Deps,
  event: { tenantId: string; runId: string; status: string; step: string }
): Promise<void> {
  await withContext(deps.appPool, { tenantId: event.tenantId, userId: null }, async (client) => {
    const run = await client.query(
      `SELECT r.project_id, r.definition, r.state, r.last_error, p.name AS project_name
       FROM workflow_runs r JOIN projects p ON p.id = r.project_id WHERE r.id = $1`,
      [event.runId]
    );
    if (!run.rows[0]) return;
    await ensureChannels(client, event.tenantId);
    const channel = await client.query(
      "SELECT id FROM channels WHERE tenant_id = $1 AND project_id = $2",
      [event.tenantId, run.rows[0].project_id]
    );
    if (!channel.rows[0]) return;
    const channelId = channel.rows[0].id;
    const state = run.rows[0].state as Record<string, unknown>;

    let body = "";
    let agent = executiveAssistant.agentKey;
    let metadata: Record<string, unknown> = { runId: event.runId };

    if (event.status === "waiting_for_info") {
      const missing = ((): string[] => {
        try {
          const w = state.waiting as { payload?: string };
          return (JSON.parse(w?.payload ?? "{}") as { missingFacts?: string[] }).missingFacts ?? [];
        } catch { return []; }
      })();
      body = `Before we go further I need a few organizational facts:\n${missing
        .map((k) => `• ${k.replace(/_/g, " ")}`)
        .join("\n")}\nReply here like: ${missing[0] ?? "annual_budget"}: <value> — one per line. Your answers are recorded as user-certified evidence.`;
      metadata = { ...metadata, infoRequest: missing };
    } else if (event.status === "waiting_approval") {
      const approval = await client.query(
        `SELECT id, kind, payload FROM approvals WHERE run_id = $1 AND status = 'pending'
         ORDER BY created_at DESC LIMIT 1`,
        [event.runId]
      );
      if (!approval.rows[0]) return;
      const kind: string = approval.rows[0].kind;
      const payload = approval.rows[0].payload as Record<string, unknown>;
      agent = kind === "bid_decision" ? "grant.funding_strategist"
        : kind === "publish_site" ? "website.qa_deployment"
        : kind === "website_brief" ? "website.digital_strategist"
        : kind === "final_export" ? "grant.reviewer_panel" : "grant.writer";
      body = kind === "website_brief"
        ? `I've put the website brief together — goals, audiences, sitemap, and visual direction. Open it in the artifact panel, then say "approve" to start the build or "pass" and tell me what to change. Nothing gets built until you're happy with the plan.`
        : kind === "bid_decision"
        ? `Bid assessment ready: ${String(payload.recommendation ?? "").replace(/_/g, " ")} (${payload.total}/100). ${payload.rationale ?? ""}\nSay "approve" to pursue it or "reject" to pass.`
        : kind === "publish_site"
          ? `The website release is built and previewable${payload.version ? ` (v${payload.version})` : ""}. Say "approve" to publish or "reject" to hold it.`
          : `The application passed internal review${payload.reviewScore ? ` (panel score ${payload.reviewScore})` : ""} and is ready to export. Say "approve" to export or "reject" to send it back for redrafting.`;
      metadata = { ...metadata, approvalId: approval.rows[0].id, approvalKind: kind, approvalPayload: payload };
    } else if (event.status === "completed") {
      body = state.exported
        ? `Done — the application package is exported. Open the artifact panel to download it (markdown + budget CSV). Remember: a strong application improves your odds; funding is never guaranteed.`
        : state.published === true
          ? `The website is live. 🎉`
          : state.published === false
            ? `Noted — the release stays unpublished. Ask me for changes anytime.`
            : state.applied === false
              ? `The Website Team couldn't translate that request: ${state.reason ?? "no reason given"}.`
              : state.outcome === "not_pursued"
                ? `We're passing on this opportunity — it's recorded as not pursued so the effort goes where it counts.`
                : `That workflow finished.`;
    } else if (event.status === "failed") {
      body = `Something went wrong and the team stopped after several attempts: ${run.rows[0].last_error ?? "unknown error"}. The run is preserved and can be resumed once the cause is fixed.`;
    } else if (event.status === "suspended_budget") {
      body = `Pausing — this run hit its usage budget. A human needs to review before the team continues.`;
    }
    if (!body) return;
    await insertMessage(client, {
      tenantId: event.tenantId, channelId, authorKind: "agent", authorAgent: agent, body, metadata,
    });
    deps.engine.events.emit("event", { type: "message_created", tenantId: event.tenantId, channelId } as never);
  });
}
