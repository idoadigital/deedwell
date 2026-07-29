# ADR-0005: Desktop client architecture (Tauri 2 + React SPA over the HTTP/SSE API)

Status: accepted · Date: 2026-07-29

## Decisions

1. **Pure API client.** The Tauri shell hosts a React/TypeScript SPA that talks only to the
   Deedwell API over HTTPS + SSE. No business logic, no database access, and — per BRD §5.1 —
   no model-provider credentials live in the desktop app. The same SPA can later be served as
   the browser app unchanged.

2. **Minimal shell permissions.** The Tauri capability file grants `core:default` only — no
   filesystem, shell, or process APIs. Uploads/downloads go through the webview's standard
   file input and blob download. The CSP in `tauri.conf.json` restricts `connect-src` to the
   Deedwell API origins.

3. **Fetch-based SSE, not EventSource.** `EventSource` cannot send an `Authorization` header,
   which forces tokens into URLs (where proxies and logs see them). We stream
   `text/event-stream` over `fetch` with the bearer header and parse incrementally
   (`src/sse.ts`, unit-tested). An 8s poll covers reconnect gaps.

4. **Session token in `localStorage` — accepted Phase 1 tradeoff.** The webview loads only our
   own bundled code under a strict CSP (no third-party scripts), so XSS surface is minimal.
   Migration to OS-keychain storage (Tauri stronghold/keyring plugin) is scheduled with the
   Phase 7 hardening pass; the `api.ts` token accessor is the single seam to swap.

5. **Conversation = real records, honestly.** The "chat" timeline renders the run's actual
   step journal, approvals, and waiting states as messages from named agents, and the composer
   is contextual (intake form, fact requests, approval actions). Free-form Executive Assistant
   chat requires a real model provider and a messages backend — it arrives with that work, and
   the UI does not fake it.

6. **Base64 JSON uploads.** Kept from the API's Phase 2 design; the 8 MB cap makes this fine
   for text opportunity documents. Multipart streaming replaces it when PDF/DOCX parsing lands.

## Verification on this branch

`cargo check` compiles the shell on Linux (webkit2gtk 4.1); `vite build` produces the SPA
(~56 kB gzipped); SSE, CORS scoping, and the new workspace endpoints are covered by tests.
Windows/macOS installers, code signing, and auto-update (BRD §5.2) are Phase 7 work and are
not claimed.
