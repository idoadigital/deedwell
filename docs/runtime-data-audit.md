# Runtime Data Audit

Audit of every mock/fixture/dummy-data source in the codebase (2026-07-30).

## Finding: production paths are database-backed

Users, organizations, channels, messages, runs, approvals, artifacts, sites, releases, and
submissions are all real Postgres records behind RLS. There are **no** hardcoded users/orgs/
channels/messages, no setTimeout-simulated responses, no static JSON handlers, no fake
progress states, and no fixtures imported by production components. Working/typing states in
the UI are driven by real in-flight requests and real run rows (see Chat.tsx `awaitingReply`,
App.tsx `workingRun`). No fake website URLs exist: preview/live URLs come from `site_releases`
rows written only after a real build, and the router 404s until a release exists.

## Intentionally mocked integrations (explicit env flags, never silent)

| Source | File | Mode | Production behavior | Risk |
|---|---|---|---|---|
| `MockModelProvider` + `mock-intent/website` | packages/agent-runtime/src/mock-*.ts | `MODEL_PROVIDER=mock` (default for tests/CI) | `MODEL_PROVIDER=openai` uses the real adapter; unknown value **throws at boot** — no silent fallback. Mock outputs are watermarked "[mock provider]"/"[mock router]". | Low — visible watermark, boot-time selection |
| `MockGrantSource` | packages/grant-domain/src/sources.ts | `GRANT_SOURCE=mock` (tests) | `grants_gov` (default) calls the real Grants.gov API; failures surface as errors ("No results were fabricated"), never fake results. Mock titles carry "[mock source]". | Low |

## Seed data

Demo content (demo account, Riverbend org, passport facts) is created only by explicit
shell commands / `demo.sh` — never imported by application code. Agent definitions are
platform registry rows seeded idempotently at boot (not tenant content).

## Removed in this audit

Nothing needed removal; the gaps were experiential (no working states, website built without
discovery) and are fixed in this change set, not data-related.
