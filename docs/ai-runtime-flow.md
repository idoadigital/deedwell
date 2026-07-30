# AI Runtime Flow (verified 2026-07-30)

Desktop client (`apps/desktop/src/api.ts sendMessage`, bearer token, idempotency clientKey)
→ **POST /v1/orgs/:id/channels/:id/messages** (`apps/api/src/routes-chat.ts`; zod-validated,
RLS transaction) → `handleUserMessage` (`apps/api/src/assistant.ts`): stores the user message,
builds bounded context, calls `runAgentTask` with the Executive Assistant definition
→ **ModelProvider** (`packages/agent-runtime`): `OpenAiProvider` (env `OPENAI_API_KEY`,
`OPENAI_MODEL`, backend-only — the key never reaches the client) or clearly-marked mock;
zod-validated typed intent with bounded retries → deterministic executor (search/workflows/
approvals — free text never triggers actions directly) → tool calls go through the audited
Tool Gateway (`tool_invocations`) → replies persist to `messages` → longer work runs in the
durable workflow engine; milestones post back via the engine→channel bridge → realtime
delivery over authenticated SSE (`/v1/orgs/:id/events`, fetch-streamed) + poll fallback.

- **Streaming**: milestone-level (workflow stages as messages). Token-level streaming is a
  known non-goal of the current request/response intent path — honestly represented in the UI
  by the real in-flight typing state, never simulated.
- **Metadata**: every model call logs `{requestId, provider, model, schema, ms, tokens, ok}`
  (openai-provider.ts); tokens/steps persist per run in `usage_ledger`; audits carry human +
  agent identity.
- **Diagnostics**: authenticated `GET /v1/diagnostics` → provider configured/connectivity,
  database, workflow engine, active runs, realtime. No secrets, prompts, or user content.
- **Errors**: provider/tool failures surface as run `failed` (journaled attempts) or honest
  chat errors with retry; the UI restores the composer text for resend (same clientKey ⇒ safe).
