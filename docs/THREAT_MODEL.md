# Deedwell Threat Model (initial)

Scope: Phase 0 foundation + Phase 2 vertical slice. STRIDE-organized, ranked by risk.

## Assets

Tenant organizational data (facts, finances, documents), grant drafts, credentials/sessions,
audit integrity, model API keys, platform availability, customer domains/TLS (later phases).

## T1 — Cross-tenant data access (highest)

*Vectors:* missing tenant filter, IDOR on UUIDs, cache/search bleed, agent context bleed.
*Controls:* `tenant_id` on every tenant table; Postgres RLS with `app.tenant_id` set per
transaction under a non-bypass role; all lookups scoped by tenant even with RLS (defense in
depth); Tool Gateway requires tenant identity; object keys server-generated with tenant prefix.
*Verification:* `tests/security/cross-tenant.test.ts` — org A token against org B resources
(404/403 required), and direct SQL under the app role returns zero foreign rows.

## T2 — Prompt injection from uploaded/retrieved content

*Vectors:* grant PDFs containing "ignore previous instructions", hostile web content (later),
injected instructions attempting tool escalation or data exfiltration.
*Controls:* instruction/data separation (documents wrapped in explicit data delimiters with a
standing rule that document content is never instructions); typed output schemas — free-text
cannot trigger actions; tools resolved from the agent's allowlist only, never from model text;
approval gates for consequential actions; dangerous-instruction heuristics flag suspicious
uploads for review.
*Verification:* `tests/security/prompt-injection.test.ts` — a malicious document must not alter
agent tool usage or leak other-tenant data; flagged content is surfaced.

## T3 — AuthN/AuthZ failures

*Vectors:* token theft, session fixation, role escalation, frontend-only checks.
*Controls:* opaque 256-bit tokens stored **hashed**; sessions expire and rotate; scrypt password
hashing with per-user salt; role checks server-side per route (owner/admin/member/viewer);
authorization enforced again at DB (RLS) and gateway layers.

## T4 — Secret exposure

*Controls:* secrets only via environment; no secrets in git (enforced `.gitignore` +
`.env.example`); logger redaction of `password|token|secret|key|authorization`-shaped fields;
model keys never sent to clients; desktop app (Phase 1) receives no provider credentials.
*Verification:* log-redaction unit test.

## T5 — Approval-gate bypass

*Vectors:* agent or API path that publishes/exports without approval.
*Controls:* gates are workflow states persisted server-side; export step refuses to run unless
an `approvals` row with `approved` status exists for that run; approvals record the human identity.
*Verification:* integration test attempts export before approval → rejected.

## T6 — Workflow abuse / runaway cost

*Controls:* per-run step budget and per-step retry caps; exceeded budget suspends the run
(`suspended_budget`) and requires human resume; usage recorded in `usage_ledger`.

## T7 — Malicious uploads

*Controls:* type/extension allowlist, size caps, files stored outside web root with server-named
keys, parsed in-process only via safe text extraction (untrusted binary parsing goes to sandboxed
workers when PDF/OCR lands); virus-scan worker slot reserved in compose.

## T8 — TLS issuance abuse (Phase 5, designed now)

*Controls:* Caddy `on_demand_tls.ask` endpoint performs an indexed lookup in the approved
`domains` registry; unverified domains are refused; verification requires DNS proof of control.

## T9 — Audit tampering

*Controls:* append-only `audit_events` (no UPDATE/DELETE grants for the app role); every event
carries tenant, actor (human and/or agent), action, entity, and hash-chained `prev_hash` for
tamper evidence.

## Non-goals (this phase)

MFA (schema-ready, not implemented), SSO/OIDC, penetration test, DDoS resilience, sandboxed
site-build workers, malware scanning engine — tracked in the phase backlog, not claimed.
