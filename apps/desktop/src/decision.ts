/** Mapping from real bid-decision payloads to the GrantDecisionCard display. */

export interface BidPayload {
  recommendation?: string;
  total?: number;
  rationale?: string;
  dimensions?: Array<{ key: string; label: string; score: number; note: string }>;
}

export function fitLabel(recommendation: string | undefined, total: number): {
  label: string; tone: "good" | "warn" | "low";
} {
  if (recommendation === "apply") return { label: "Strong Fit", tone: "good" };
  if (recommendation === "needs_review") return { label: "Worth Reviewing", tone: "warn" };
  return { label: total >= 45 ? "Weak Fit" : "Poor Fit", tone: "low" };
}

export function headline(recommendation: string | undefined): string {
  if (recommendation === "apply") return "This grant is worth pursuing.";
  if (recommendation === "needs_review") return "This one deserves a closer look before committing.";
  return "We recommend passing on this one.";
}

const CHIP_WORDS: Record<string, [string, string, string]> = {
  // [high, medium, low] wording per dimension key
  eligibility: ["Confirmed", "Likely", "Unclear"],
  time: ["Comfortable", "Workable", "Tight"],
  readiness: ["Strong", "Building", "Early"],
  fit: ["High", "Moderate", "Low"],
  complexity: ["Manageable", "Moderate", "Heavy"],
};

export function chips(dimensions: BidPayload["dimensions"]): Array<{
  label: string; value: string; good: boolean;
}> {
  return (dimensions ?? []).slice(0, 3).map((d) => {
    const words = CHIP_WORDS[d.key] ?? ["Strong", "Moderate", "Low"];
    const value = d.score >= 4 ? words[0] : d.score >= 3 ? words[1] : words[2];
    return { label: d.label, value, good: d.score >= 4 };
  });
}
