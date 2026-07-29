# ADR-0002: Postgres-backed durable workflow engine now; Temporal behind the same interface later

Status: accepted · Date: 2026-07-29

## Context

BRD §7.2 requires "Temporal or an equivalent self-hostable durable execution engine" with
crash recovery, retries, approval waits, idempotency, and resume-after-deploy. Temporal brings
a server cluster, workers, versioning discipline, and significant operational surface — heavy
for a single-server private beta and a first vertical slice.

## Decision

Implement a minimal durable engine on Postgres behind a `WorkflowEngine` interface:

- Runs are rows; state is jsonb; steps are named idempotent functions.
- Worker claims via `FOR UPDATE SKIP LOCKED` + lease columns; one step per claim; step result
  and journal row commit atomically with the state update.
- Crash before commit ⇒ step re-executes (idempotency required; external effects record
  idempotency keys in state before acting).
- `wait()` semantics park runs for approvals/info; API actions re-enqueue.
- Bounded per-step retries with backoff; exhaustion ⇒ resumable `failed`.

## Swap trigger (adopt Temporal when any holds)

1. Workflows need timers/schedules beyond simple polling (deadline reminders at scale).
2. Multiple worker nodes with mixed workflow versions in flight.
3. Child workflows / signals become common patterns.

The engine interface (start, signal, claim/execute, cancel) is deliberately shaped so a
`TemporalWorkflowEngine` can implement it without touching workflow definitions' step logic.

## Consequences

+ Zero extra infrastructure; the whole slice is testable with Postgres alone; durability
  semantics are transparent and directly tested (kill-and-resume test).
− We own retry/lease correctness; no built-in workflow versioning UI; migration cost later
  (bounded by the interface).
