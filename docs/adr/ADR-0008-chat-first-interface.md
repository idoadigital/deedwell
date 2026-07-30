# ADR-0008: Chat-first, Slack-style interface (supersedes the module-nav workspace)

Status: accepted · Date: 2026-07-30 · Driven by the product owner's interface spec.

## Decisions

1. **The product IS a team-messaging app.** Four areas: workspace rail (org switching),
   conversation sidebar (Starred / Channels / AI Teammates / People / Recent), active
   conversation, and a contextual artifact panel that opens beside the chat only on demand.
   Product functions live inside conversations and menus — the module sidebar is gone;
   Grants/Website/Passport/Approvals overviews open as dialogs from the workspace menu.

2. **AI teammates are people you DM.** Thirteen named teammates (Maya EA, Daniel PM, Amara,
   David, Grace, Sophia, Michael, Naomi, Ava, Leo, Noah, Emma, James) exist from workspace
   creation with DM conversations pre-provisioned; Maya greets first-time users. Display
   identities live in `apps/api/src/teammates.ts`; underlying agent keys are unchanged.

3. **Messages backend** (`channels`, `messages`, migrations 0004/0005): team channels
   (#general, #announcements, #funding-opportunities, #grant-work, #website,
   #organization-information), project channels (a project IS a channel — user-created
   channels create a backing project), and DM channels per teammate.

4. **The Executive Assistant routes; deterministic code executes.** Every user message maps
   to ONE typed `IntentOutput` action (search, apply, build/update website, provide facts,
   approve/reject, status, answer, clarify). Free text never triggers actions directly.
   Under the mock provider the router is rule-based and says so when it can't parse; the
   `OpenAiProvider` adapter (OPENAI_API_KEY + MODEL_PROVIDER=openai) provides real language
   understanding through the same seam — including all existing agent output schemas, so a
   real key upgrades drafting/planning content quality everywhere at once.

5. **Workflow milestones are teammate messages.** An engine-event bridge posts info requests,
   bid/publish/export approvals (with inline Approve/Reject), completions, and honest failures
   into the owning project channel, authored by the responsible teammate. Agents create
   channels for new work ("apply for #1" → #<grant-name> with the team in it).

6. **Deferred honestly:** voice huddles (Phase 6 — button present, says so), human-to-human
   DMs, threads UI and reactions (schema supports threads via parent_id), message search
   beyond client-side filtering.

## Ops note

Demo and tests now use separate databases (`deedwell_demo` vs `deedwell`) — the test suite's
truncation wiped demo data when they shared one. `demo.sh` launches the stack and picks up
`.env` (OpenAI key) automatically.
