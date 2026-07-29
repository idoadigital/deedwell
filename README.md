# Deedwell

AI workforce and operating workspace for nonprofit organizations.

This repository contains **Phases 0–4** of the Deedwell platform: the tenant-isolated,
RLS-enforced core with a durable workflow engine and tool-gated agent runtime (Phase 0), the
Tauri desktop workspace (Phase 1), the original vertical slice (Phase 2), the **full grant
workspace** (Phase 3) —

> discover an opportunity (live Grants.gov search) or upload its announcement → requirements
> extracted with source locations → deterministic eligibility check against the Funding
> Passport (missing facts are requested, never assumed) → weighted bid/no-bid score behind a
> human gate → section planning → per-section drafting with unsupported-claim flagging →
> validated line-item budget → logic model → four-persona reviewer panel → deterministic
> compliance checks → final human approval → exported package (markdown + budget CSV) →
> outcome tracking (awarded/rejected, amounts, lessons).

— and the **website builder** (Phase 4):

> the Website Team drafts a brief and writes pages from approved facts (placeholders flagged,
> never invented) → approved-template static build (zero JS, everything escaped, WCAG-checked
> palettes) → deterministic SEO/accessibility checks → preview on its own origin via the Site
> Router → human publish approval → immutable releases with one-click rollback →
> conversational updates as reviewable patches → contact/volunteer forms with tenant-scoped
> submissions.

Read first: `docs/FIRST_RESPONSE.md` (the BRD §25 analysis), then `docs/ARCHITECTURE.md`,
`docs/THREAT_MODEL.md`, `docs/DATA_MODEL.md`, and `docs/adr/`.

## Honest status

- The model provider is a **deterministic mock** (ADR-0003). The harness — schemas, retries,
  budgets, gateway, approvals, durability, tenancy — is real and tested; content quality with a
  real model is not yet certified. No real provider integration is faked.
- The workflow engine is a Postgres-backed durable engine (ADR-0002) behind a `WorkflowEngine`
  interface with a documented Temporal adoption path.
- The desktop app (Phase 1) is a Tauri 2 shell around a React SPA (ADR-0005): login/registration,
  organization creation and switching, projects, an agent-activity workspace with live SSE
  updates, artifact panel with version diffs, and the approval interface. The "chat" timeline
  renders real workflow records; free-form assistant chat waits for a real model provider.
  Installers/code-signing/auto-update are Phase 7.
- Phase 3 judgment calls are deterministic by design (ADR-0006): the eligibility engine and
  bid/no-bid scoring are rules code the model cannot override. Grants.gov discovery is a real
  integration; `GRANT_SOURCE=mock` keeps tests hermetic.
- Phase 4 websites (ADR-0007) are static releases from approved templates — no arbitrary code
  generation, no scripts, strict CSP, separate origins for preview/live. Custom domains + TLS
  (Phase 5) and huddles (Phase 6) are **not built** and nothing here pretends they are.

## Getting started

```bash
pnpm install

# Postgres (dev)
docker run -d --name deedwell-pg -e POSTGRES_PASSWORD=deedwell \
  -e POSTGRES_USER=deedwell -e POSTGRES_DB=deedwell -p 55432:5432 postgres:16-alpine

cp .env.example .env   # then set real values
pnpm migrate           # applies migrations + bootstraps the RLS-bound app role
pnpm dev:api           # API on :3000 with the in-process worker
```

## Tests

```bash
pnpm test        # unit + integration + security suites (needs the dev Postgres)
pnpm typecheck
```

The suites cover: full end-to-end slice, worker-restart durability, retry exhaustion,
cross-tenant isolation (API + RLS under the app role), approval-gate enforcement,
prompt-injection flagging, and secret redaction.

## Desktop app (Phase 1)

```bash
pnpm dev:api                        # API on :3000 (in one terminal)
cd apps/desktop && pnpm dev         # workspace UI on :5173 (browser or Tauri webview)
# Native shell (needs Rust + platform webview deps):
cd apps/desktop && pnpm tauri dev
```

## Layout

```
apps/api            Fastify API + worker entries (SSE realtime, approvals, exports)
apps/desktop        Tauri 2 desktop shell + React workspace SPA (ADR-0005)
apps/site-router    Public static-site host: Host→release resolution, forms (ADR-0007)
packages/schemas    zod contracts shared everywhere
packages/auth       scrypt passwords, hashed session tokens, role hierarchy
packages/database   pool, migrations + RLS, tenant-scoped tx, hash-chained audit, storage seam
packages/agent-runtime  ModelProvider abstraction + deterministic mock + runAgentTask
packages/tools      Tool Gateway (identity, allowlists, validation, audit)
packages/workflows  durable Postgres workflow engine (ADR-0002)
packages/grant-domain   Grant Team agents, tools, claim verification, workflows
packages/website-domain Website Team agents, renderer, checks, build/update workflows
infrastructure/     Docker Compose + Caddy edge (approved-domain TLS gate designed in)
docs/               BRD analysis, architecture, threat model, data model, ADRs
tests/              integration + security suites
```
