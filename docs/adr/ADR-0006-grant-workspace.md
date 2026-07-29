# ADR-0006: Phase 3 grant workspace — deterministic judgment, model-drafted content

Status: accepted · Date: 2026-07-29

## Decisions

1. **Eligibility is a rules engine, not a model call.** Rules are *derived* from the
   announcement's eligibility requirements (entity type, registration, budget caps, geography,
   deadline) and evaluated deterministically against the fact ledger. Statuses distinguish
   verified vs user-certified evidence, and missing information yields
   `insufficient_information` — never eligibility. The model only extracts text.

2. **Bid/no-bid is deterministic weighted scoring** over computed inputs (eligibility status,
   days to deadline, Funding Passport completeness, award-size fit, requirement burden), with
   hard vetoes (ineligible, passed deadline → do_not_apply). The recommendation gates the
   workflow behind a human `bid_decision` approval; declining ends the run cleanly with the
   opportunity marked `not_pursued`.

3. **Grants.gov discovery is a real integration** (`GrantsGovProvider`, public Search2 API,
   verified live) behind a `GrantSourceProvider` interface with a clearly-marked mock for tests
   and offline dev (`GRANT_SOURCE=mock`). Other sources (foundation databases, EU portals) plug
   into the same interface later.

4. **Funding Passport = typed catalog over the fact ledger.** Passport fields are a structured
   catalog (sections, required flags) whose values live in `org_facts` with provenance
   (`user_certified`, certifier identity). Completeness weights required fields 80/20.

5. **Full workflow shape**: parse → extract → eligibility (pauses for missing facts) → bid
   score → **bid gate (human)** → plan sections → draft each section (cursor loop, one section
   per durable step) → budget (validated: every activity costed) → logic model → four-persona
   reviewer panel → deterministic compliance checks → **final gate (human)**; rejection at the
   final gate loops back to redrafting (new artifact versions); approval exports
   markdown + budget CSV. DOCX/PDF/XLSX renderers are pending and not faked.

6. **Queryable domain tables, not just artifacts**, for everything metrics need
   (BRD §19): `eligibility_results`, `bid_decisions`, `grant_applications`,
   `application_sections`, `budgets/budget_items`, `review_runs/review_scores`,
   `grant_outcomes`. Logic models stay artifact-only until a consumer needs them relational.

## Also fixed in this phase

Workflow-engine retry timestamps are now computed in **database time** (`now() + interval`)
instead of the JS clock — a 0 ms backoff could previously land microseconds past the claim
query's `now()` and strand a retry. (Surfaced while chasing a test flake whose primary cause
was an orphaned dev server's inline worker polling the shared database; both addressed.)

## Content quality caveat (unchanged from ADR-0003)

Section drafts, plans, budgets, logic models, and reviewer scores are produced by the
deterministic mock provider in dev/CI. The harness — gating, verification, claim flagging,
compliance math, tables, exports — is what this phase certifies. Content quality certification
requires a real `ModelProvider` adapter.
