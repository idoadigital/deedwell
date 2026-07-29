import type { ExtractedRequirement } from "@deedwell/schemas";

/**
 * Deterministic mapping from requirement kinds to the organizational facts
 * needed before drafting can proceed. Missing information is requested, never
 * guessed (BRD: missing information must not be treated as eligibility).
 */
const KIND_FACTS: Record<string, string[]> = {
  eligibility: ["legal_name", "entity_type", "registration_status"],
  budget: ["annual_budget"],
};

const ALWAYS_REQUIRED = ["legal_name", "mission"];

export function requiredFactKeys(requirements: Pick<ExtractedRequirement, "kind">[]): string[] {
  const keys = new Set(ALWAYS_REQUIRED);
  for (const req of requirements) {
    for (const key of KIND_FACTS[req.kind] ?? []) keys.add(key);
  }
  return [...keys].sort();
}
