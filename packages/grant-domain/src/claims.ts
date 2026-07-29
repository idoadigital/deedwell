import type { OrgFact, SectionClaim } from "@deedwell/schemas";

/**
 * Server-side claim verification. The model's own support labels are treated
 * as untrusted: support is recomputed from the organization's fact ledger.
 * A claim is supported only by a verified or user-certified fact; everything
 * else is flagged (BRD §2.5 "evidence before eloquence").
 */
export function verifyClaims(
  claims: SectionClaim[],
  facts: OrgFact[]
): { claims: SectionClaim[]; flaggedCount: number } {
  const ledger = new Map(facts.map((f) => [f.key, f]));
  let flaggedCount = 0;
  const verified = claims.map((claim) => {
    const fact = claim.factKey ? ledger.get(claim.factKey) : undefined;
    const support = fact ? fact.status : "unsupported";
    const flagged = !(support === "verified" || support === "user_certified");
    if (flagged) flaggedCount++;
    return { ...claim, support, flagged } satisfies SectionClaim;
  });
  return { claims: verified, flaggedCount };
}
