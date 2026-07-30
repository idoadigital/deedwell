import { describe, expect, it } from "vitest";
import { chips, fitLabel, headline } from "./decision";

describe("GrantDecisionCard mapping", () => {
  it("maps recommendations to fit labels and headlines", () => {
    expect(fitLabel("apply", 79)).toEqual({ label: "Strong Fit", tone: "good" });
    expect(fitLabel("needs_review", 50)).toEqual({ label: "Worth Reviewing", tone: "warn" });
    expect(fitLabel("do_not_apply", 30).tone).toBe("low");
    expect(headline("apply")).toContain("worth pursuing");
    expect(headline("do_not_apply")).toContain("passing");
  });

  it("turns real scoring dimensions into readable chips", () => {
    const out = chips([
      { key: "eligibility", label: "Eligibility confidence", score: 4, note: "" },
      { key: "time", label: "Time to deadline", score: 5, note: "" },
      { key: "readiness", label: "Organizational readiness", score: 2, note: "" },
      { key: "fit", label: "Funding size fit", score: 5, note: "" },
    ]);
    expect(out).toHaveLength(3); // top three only
    expect(out[0]).toEqual({ label: "Eligibility confidence", value: "Confirmed", good: true });
    expect(out[2]).toEqual({ label: "Organizational readiness", value: "Early", good: false });
  });
});
