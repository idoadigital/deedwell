# ADR-0003: ModelProvider abstraction with a deterministic mock as the CI baseline

Status: accepted · Date: 2026-07-29

## Context

BRD §7.2 names the OpenAI Agents SDK; BRD §2.7 requires portability across providers. The BRD
also forbids fabricating integrations and requires mocks to be clearly identified.

## Decision

- All model access goes through `ModelProvider` (`packages/agent-runtime`): typed request
  (system instructions, delimited data blocks, output schema) → typed, schema-validated response.
- Ship `MockModelProvider` — deterministic, rule-based, **clearly marked as a mock** — as the
  default in dev/CI. It implements requirement extraction and section drafting well enough to
  exercise every harness path (schemas, retries, flagging, budgets) without network or keys.
- Real adapters (`OpenAiAgentsProvider`, `AnthropicProvider`) are explicit TODOs implementing
  the same interface; business logic never imports a vendor SDK directly.

## Consequences

+ CI is hermetic and fast; evaluation baselines are reproducible; provider swap is config.
− Mock quality ≠ model quality: acceptance of *content* quality waits for a real adapter;
  the harness, security, and durability guarantees are what this phase certifies.
