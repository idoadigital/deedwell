# Deedwell Data Model

Canonical DDL lives in `packages/database/migrations/`. All tenant-owned tables carry
`tenant_id`, `created_at`, `updated_at`; identity tables use UUIDv7-style ordered UUIDs
(generated app-side). RLS policies compare `tenant_id` to `current_setting('app.tenant_id')`.

## Implemented (migration 0001)

### Identity & tenancy
- `users` — email (citext-unique), password_hash (scrypt), display_name, mfa_enrolled (future).
- `organizations` — the tenant unit; slug, name, profile jsonb (funding-passport seed).
- `organization_memberships` — user↔org with role: `owner | admin | member | viewer`
  (BRD's finer roles map onto these four permission tiers for MVP; the column is text to extend).
- `sessions` — token_hash (sha-256 of opaque token), user_id, expires_at, revoked_at.
- `invitations` — email, org, role, token_hash, expires_at.

### Work
- `projects` — tenant-scoped container; type (`grant_application | website | other`), status.
- `files` — tenant/project-scoped upload metadata; storage_key (server-generated), sha256,
  mime, size, scan_status.

### Workflow engine
- `workflow_runs` — definition, definition_version, status
  (`pending | running | waiting_for_info | waiting_approval | suspended_budget | failed | completed | cancelled`),
  current_step, state jsonb, step_budget, steps_used, claimed_by/claimed_at (worker lease),
  last_error.
- `workflow_steps` — append-only journal: run, seq, step name, attempt, status, input/output
  summaries, error, duration.
- `approvals` — run-scoped approval requests: kind, payload, status
  (`pending | approved | rejected`), decided_by, decided_at, note.

### Agents & tools
- `agent_definitions` — versioned typed agent records: agent_key, version, role, team,
  instructions, allowed_tools text[], output_schema_ref, budgets jsonb. Platform-level (not tenant data).
- `tool_invocations` — audit of every gateway call: tenant, run, agent_key, tool, ok,
  input/output summaries (redacted), duration.

### Artifacts
- `artifacts` — tenant/project-scoped; type (`compliance_matrix | grant_section | export_package`),
  title, current_version.
- `artifact_versions` — append-only; artifact, version, content jsonb, created_by_kind
  (`user | agent`), created_by, change_summary.

### Grants (slice subset)
- `grant_opportunities` — tenant-scoped; title, funder, source (`upload | manual`), file_id, raw_text_key.
- `grant_requirements` — opportunity-scoped; requirement text, kind, mandatory bool,
  source_location (page/line/quote), word_limit, status.
- `org_facts` — the evidence ledger seed: fact_key, value, status
  (`verified | user_certified | estimate | assumption | unsupported`), source, certified_by.

### Governance
- `audit_events` — append-only, hash-chained (`prev_hash`, `event_hash`); tenant, actor_user,
  actor_agent, action, entity_type/id, metadata jsonb (redacted).
- `usage_ledger` — tenant, run, kind (`model_tokens | steps`), quantity, metadata.

## Phase 3 (migration 0002)

- `grant_opportunities` gains number/agency/deadline/funding range/geography/source_url/status;
  sources extended with `grants_gov`.
- `eligibility_rules` / `eligibility_results` — derived rules + per-rule findings and missing facts.
- `bid_decisions` — dimension scores, total, recommendation, human decision + identity.
- `grant_applications` / `application_sections` — application lifecycle; sections link to their
  drafted artifacts with word limits and requirement line references.
- `budgets` / `budget_items` — validated line items (unique per budget+description for idempotent rebuilds).
- `review_runs` / `review_scores` — reviewer-panel metrics (append-only).
- `grant_outcomes` — submitted/awarded/rejected etc., award amount, feedback, lessons.
- Artifact types extended: `application_plan, budget, logic_model, review_report, compliance_report`.
- Logic models remain artifact-content (ADR-0006) until a consumer needs them relational.

## Designed, not yet migrated (added in their phases)

- Websites: `sites, site_pages, site_components, site_media, site_releases, deployments,
  domains, domain_verifications, dns_checks, forms, form_submissions, redirects` (Phase 4–5).
- Communication: `channels, threads, messages, huddles, transcripts` (Phase 6).
- Billing: `billing_accounts, subscriptions, quotas` (Phase 7).
- Knowledge: `knowledge_items, claims, claim_sources, conflicts` (`org_facts` is the seed).

Rationale: shipping empty tables invites drift; each phase lands its migration with its code.
