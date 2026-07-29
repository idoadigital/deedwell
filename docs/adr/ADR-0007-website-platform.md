# ADR-0007: Website platform — structured CMS, approved templates, static releases

Status: accepted · Date: 2026-07-29

## Decisions

1. **Structured content model is canonical; chat proposes patches.** Pages are rows
   (`site_pages`) of typed, zod-validated blocks (hero, text, programs, stats, cta, form,
   contact). Conversational edits produce a `SitePatchOutput` against this model — either an
   applied patch with a change summary, or an honest `applied: false` with a reason that the
   UI surfaces verbatim. The mock provider handles a few patterns and says so; it never fakes
   understanding.

2. **Approved-template renderer, zero JavaScript, everything escaped.** Sites are rendered
   server-side from components into self-contained accessible HTML (inline CSS, skip links,
   labeled forms, single h1, sitemap/robots). No arbitrary code generation (BRD §10.2); all
   user content passes `esc()`, hrefs are allowlisted to internal paths and http(s), and a
   "no script tags" check enforces the policy on every build. Palettes are pre-validated for
   WCAG contrast.

3. **Immutable static releases + Site Router.** Every build writes files under
   `tenants/<t>/sites/<id>/releases/v<n>/` and records an immutable `site_releases` row with
   its check results. The Site Router resolves Host (`<slug>.preview.<base>` /
   `<slug>.<base>`; path-based `/preview/:slug`, `/live/:slug` in dev) → release prefix via an
   indexed slug lookup and serves the artifact with a strict CSP (`default-src 'none'`),
   nosniff, and frame denial. Unknown hosts get a safe 404 page. No permanent per-tenant
   containers (BRD §10.1). Publishing requires human approval; rollback flips the active
   release pointer to any previously published version.

4. **Preview isolation.** Preview and live origins are separate from the app origin (Caddy
   config); the router never sees app cookies or tokens, and served pages contain no scripts,
   so preview content cannot reach the workspace (threat R6).

5. **Forms are the controlled shared dynamic API** (BRD §10.1): rendered forms post to the
   site's own origin (`/forms/<slug>/<key>`, satisfying `form-action 'self'`); the router
   validates field names/sizes, drops honeypot hits without signaling bots, stamps the tenant
   from the site record, and stores submissions read back through the RLS-bound API.

6. **Deterministic SEO/accessibility review.** The "reviewer agent" is rules code over the
   rendered output: titles, meta descriptions, h1 count, lang, labeled inputs, resolving
   internal links, placeholder detection. Failures surface in the publish-approval payload;
   the deterministic checks caught a real defect (missing h1 on non-hero pages) during
   development.

7. **Global slug namespace with reserved labels** (www/api/admin/preview/…) since slugs become
   subdomains. Conflicts 409 at creation.

## Deferred (not faked)

Custom domains + DNS verification + on-demand TLS (Phase 5), media library/image uploads,
private expiring preview links, per-tenant analytics, CDN caching beyond `max-age=60`.
