# Website Workflow (staged; spec §5)

`website-build` v2: **discovery** (checks the fact ledger; asks only for what's missing —
mission, programs, beneficiaries, service area, contact — via the same conversational
info-request used everywhere; answers are user-certified facts, importable from the Passport)
→ **brief** (Ava drafts goals/audiences/sitemap/tone/theme as a versioned artifact) →
**brief approval gate** (nothing is generated before "approve"; "pass" stops honestly) →
**generate** (Emma writes pages from facts; placeholders flagged) → **build** (static render:
every sitemap page, shared nav, footer, sitemap.xml, robots.txt, 404.html; forms only against
the real submissions handler) → **validation** (deterministic checks: titles, meta, single h1,
labels, internal links resolve, no scripts, placeholders) → **preview** (immutable release;
path-preserving direct/nested routes; site-specific 404 with real 404 status — never redirect
to home) → **publish gate** (human approval; release flips atomically; rollback to any prior
published release) → conversational revisions via `website-update` (patch → rebuild →
re-validate → new preview → approval). All stages persist as workflow state and survive
restarts; progress arrives as teammate messages.
