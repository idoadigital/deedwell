# Deedwell Architecture

## Overview

Deedwell is a modular monolith (Fastify API + workflow worker) around PostgreSQL, with hard
TypeScript interfaces at every external seam (models, voice, embeddings, search, documents,
workflow engine, object storage). Clients (desktop Tauri app, public web) speak HTTPS + SSE.

## Services (current)

| Service | Package | Role |
|---|---|---|
| API | `apps/api` | HTTP API, auth, tenancy, uploads, workflow control, artifacts, approvals, exports, SSE events |
| Workflow worker | `packages/workflows` (in-process in dev; separate process via `apps/api/src/worker.ts` entry in prod) | Executes durable workflow steps |
| Postgres | infra | System of record; RLS enforces tenancy |
| Redis | infra | Queues/cache (reserved; not required by the slice) |
| Caddy | infra | TLS, security headers, reverse proxy, approved-domain TLS gate |

## Request path

1. Caddy terminates TLS, adds security headers, proxies to API.
2. API authenticates the opaque session token (hashed lookup), resolves org membership → role.
3. Handler validates input with zod, opens a transaction, sets `app.tenant_id` + `app.user_id`,
   performs tenant-scoped queries under RLS, writes an `audit_events` row for mutations.
4. Long work is never done in-request: the handler creates/updates a workflow run; the worker
   picks it up; clients observe progress via SSE (`/v1/events`) and run polling.

## Workflow engine

Postgres-backed durable execution (see ADR-0002):

- `workflow_runs` holds `{definition, version, status, current_step, state jsonb, tenant, project}`.
- Each step is a named, idempotent function `(ctx, state) → {state', next | wait | complete}`.
- The worker claims runs with `FOR UPDATE SKIP LOCKED`, executes exactly one step, persists the
  result and a `workflow_steps` journal row in the same transaction, then releases.
- Crash between claim and commit ⇒ nothing persisted ⇒ step re-runs (steps must be idempotent;
  external side effects use idempotency keys recorded in state).
- `wait('approval' | 'info', payload)` parks the run; an API action (`approve`, `provide-info`)
  re-enqueues it. Retries are per-step with bounded attempts; exhaustion ⇒ `failed` (resumable).

## Agent runtime

- `AgentDefinition` (typed, versioned): role, instructions, allowed tools, output zod schema, budgets.
- `runAgentTask` builds a minimal context (task + explicitly passed facts/documents only),
  calls `ModelProvider.complete`, validates output against the schema (retry on mismatch),
  and routes any tool use through the Tool Gateway.
- `MockModelProvider` is deterministic and clearly marked; it powers CI and evaluations.
  Real providers (OpenAI Agents SDK, Anthropic) are adapters to be added behind the same interface.

## Tool gateway

Single registration point for agent tools. Every invocation carries `{tenantId, userId, agentId,
runId}`; the gateway checks the agent's allowlist, validates input/output with zod, enforces
budgets, and writes `tool_invocations` audit rows. No identity ⇒ no call.

## Security boundaries

- RLS on every tenant table; app DB role cannot bypass it.
- Uploaded/retrieved content is data, never instructions: it is passed to models inside
  delimited document blocks, and outputs are schema-validated. Documents cannot grant tools.
- Approval gates live in the workflow engine (server side), not the UI.
- Secrets come only from env; the logger redacts known secret-shaped keys.
- Preview/customer sites (Phase 4+) get a separate origin and CSP; Caddy on-demand TLS asks the
  approved-domain registry endpoint before issuing.

## Realtime

SSE stream per session (`/v1/events`) carrying workflow/step/approval events for the user's
current org. A dedicated realtime gateway becomes its own service when fan-out justifies it.

## Evolution path

- Temporal replaces the custom engine behind `WorkflowEngine` (ADR-0002 trigger conditions).
- `worker-agent`, `worker-documents`, `worker-sites` split into their own processes/nodes.
- Site Router + static release hosting per BRD §10 in Phase 4.
- Object storage: local-FS adapter now, S3-compatible (Hetzner) adapter same interface.
