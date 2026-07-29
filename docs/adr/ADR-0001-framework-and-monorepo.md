# ADR-0001: Fastify + pnpm workspaces; Turborepo deferred

Status: accepted · Date: 2026-07-29

## Decision

- **Fastify** over NestJS for the API.
- **pnpm workspaces** with TypeScript project references; **Turborepo deferred** until the
  build graph is large enough that caching pays for the config surface.
- Monorepo layout follows BRD §24 but only creates directories for phases with code in them.

## Rationale

Fastify: lightweight modular services were explicitly one of the BRD's two sanctioned options;
the codebase is interface-driven (workflow engine, providers, gateway) and does not need Nest's
DI container; zod-first validation integrates directly; smaller dependency surface for a
security-sensitive platform.

Turborepo deferral: with ~8 packages and tsc project references, `pnpm -r build` is already
incremental. Adding Turborepo now is config without payoff. Revisit when apps/desktop and
worker apps land (Phase 1+), where remote caching starts to matter.

## Consequences

- No DI framework: constructor injection by hand; interfaces in `packages/*` keep seams testable.
- BRD deviation (no empty shell dirs) documented per §24's "modify where justified" clause.
