# Grant Application Workspace

How a grant application becomes a persistent, auditable workspace instead of a
chat transcript. Everything below is DB-backed and survives refreshes, logout,
and server restarts (verified live: a run at `extract_requirements` resumed
through `bid_gate` across an API restart with zero duplicate events).

## State model (migration 0010)

- `projects.workspace_status / workspace_phase / pending_intent` — durable task
  state. `pending_intent` stores a blocked "apply" (grant, opportunity number,
  channel) so the user never repeats the command.
- `workspace_events` — the activity timeline. One row per verifiable action:
  workspace created, retrieval started/succeeded/failed, and one per durable
  workflow step (written by the engine→workspace bridge in
  `apps/api/src/workspace.ts`, deduped per (run, step)). Failures are recorded
  as `failed` with the real error — never replaced with fake success.
- `research_sources` — provenance for every retrieval attempt: URL, publisher,
  reliability, fetch status, timestamp, excerpt, linked file.

## Flow

1. **Apply** (button sends a structured `action` with the exact grant — the
   chat still shows "Apply for #N", but the server never re-parses it; the
   button disables against double-clicks).
2. Workspace + project channel created → `workspace_created` event.
3. **Automatic retrieval**: `GrantSourceProvider.fetchAnnouncement` calls the
   real Grants.gov `fetchOpportunity` API (description, eligibility text, award
   ceiling, deadline, agency contact). Success → stored as a file + source +
   event, workflow starts immediately. Failure → `failed` event + failed
   source + `pending_intent` saved; Maya's message names the grant, the
   opportunity number, and exactly where to get the document.
4. **Auto-resume**: any upload while a `pending_intent` exists attaches the
   file, clears the blocker, starts the workflow, and says so — no repeated
   command. Uploads accept PDF/DOCX/HTML/TXT/MD (`extractDocumentText` in
   grant-domain normalizes them; users are never asked to convert files).
5. The durable workflow (unchanged engine) emits per-step timeline events with
   honest titles; entering a step is `in_progress`, transitions close it out.
6. `waiting_for_info` surfaces as the **Questions** tab: only the facts the
   eligibility check genuinely could not verify, prefilled from certified org
   facts, each with the reason it is needed.

## Reference resolution

`buildContext` now includes `pendingIntent` and `lastAssistantRequest`;
the Executive Assistant's contract requires resolving "it/that grant/the
announcement document/where do I find it" against them and forbids generic
clarifications. The mock router implements the same rules deterministically
(ordinals, named two-option clarification when genuinely ambiguous).
Structured logs: `REFERENCE_RESOLVED`, `PENDING_INTENT_SAVED`,
`PENDING_INTENT_RESUMED`, `ANNOUNCEMENT_RETRIEVAL` (ids + reason codes, no
chain-of-thought).

## Panel (frontend)

`GrantWorkspacePanel` extends the existing artifact side panel with tabs:
Overview (status, phase, step-based completion %, eligibility, next action),
Activity (timeline), Research (sources with provenance and excerpts),
Requirements (compliance matrix + eligibility), Questions (intake form),
Documents, Application (existing versioned artifacts). It opens automatically
in grant application channels; completion is computed from persisted workflow
steps, never elapsed time.

## Honest deferrals

- Browser automation: not needed for Grants.gov (official API covers search +
  full announcement); would be added only for sources without an API.
- XLSX/ZIP/image extraction, rich-text artifact editing with comments and
  suggested changes, email/push notifications (in-app messages already link to
  the workspace), SAM.gov: documented, not built.
- Submission remains human-gated: export happens only after explicit approval;
  Deedwell never submits to a portal on its own.
