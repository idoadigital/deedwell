# Agent Context & Memory System

Not a prompt hack: memory lives in the database and is loaded per response.

## Context packet (built for every agent response — assistant.ts buildContext)
- **recentTranscript** — last 14 channel messages (author + body) for immediate continuity
- **relevantHistory** — older in-channel messages matching the current ask (Postgres FTS
  websearch retrieval, project-scoped; a pgvector embedding column is the documented upgrade
  path behind this same query — hybrid by design, never vector-only)
- **knownArtifacts** — the project's artifact registry (id/type/title/version)
- **knownUrls** — generated preview/live site URLs (from site releases + project memory)
- **taskState** — the project's workflow runs (definition/status/step/error) — the persistent
  task table (received→working→waiting→completed/failed/cancelled semantics)
- **projectMemory** — durable `project_memories` row: rolling summary, key_decisions,
  known_urls, latest_status; updated automatically at every workflow milestone (previews
  built, publishes, exports, declines, failures)
- plus search results, uploads, pending approvals, waiting-run missing facts

## Response contract (in the Executive Assistant's instructions + enforced by data)
Consult context before acting; never ask for information present in it — especially links the
team generated. "What's the link to the website you built?" answers from knownUrls, stating
what was found. "Build a website" when one exists points at it instead of duplicating.
Deterministically test-covered under the mock router; identical contract drives the LLM.

## Agent identity
Persistent, versioned `agent_definitions` (identity, role, instructions, allowed tools,
output schema); 13 teammates provisioned at workspace creation.

## Observability
Each response logs `agent_context` JSON: counts of transcript/artifacts/urls/retrieved/tasks,
memory presence, build ms — the "context inspector" for debugging forgetfulness. Model calls
log requestId/model/latency/tokens.

## Preview & links (desktop)
Site Router now sends `frame-ancestors <app origins>` (was 'none' — the actual cause of the
blank preview panel). PreviewSurface renders loading/error/retry/empty states with
Open-in-Browser; `openExternal()` validates URLs and uses the Tauri opener plugin in the
shell, `window.open(noopener)` on the web; failures are shown and logged, never silent.

## Deferred honestly
Embedding-based retrieval (interface ready), cross-project org-level memory, LLM-generated
rolling summaries (milestone decisions are recorded deterministically today).
