import type { BidDimension, ExtractedRequirement, SectionClaim } from "@deedwell/schemas";

/**
 * Full application export (markdown + budget CSV). DOCX/PDF/XLSX renderers are
 * planned behind this same input shape and are NOT yet implemented — the
 * package honestly ships markdown and CSV.
 */

export interface FullExportInput {
  opportunity: { title: string; funder: string; number: string | null; deadline: string | null };
  artifacts: Array<{ type: string; title: string; content: Record<string, unknown> }>;
  budgetTotal: number | null;
  eligibility: { overall: string } | null;
  bid: { total: number; recommendation: string; rationale: string; dimensions: BidDimension[] } | null;
}

export function renderFullExport(input: FullExportInput): string {
  const byType = (type: string) => input.artifacts.filter((a) => a.type === type);
  const lines: string[] = [
    `# ${input.opportunity.title}`,
    ``,
    `Funder: ${input.opportunity.funder}` +
      (input.opportunity.number ? ` · Opportunity ${input.opportunity.number}` : ""),
    input.opportunity.deadline ? `Deadline: ${input.opportunity.deadline}` : `Deadline: not on record`,
    ``,
    `> **Disclaimer:** Deedwell helps prepare stronger, more compliant applications.`,
    `> It does not and cannot guarantee a grant award.`,
    ``,
  ];

  if (input.eligibility) {
    lines.push(`## Eligibility`, ``, `Engine result: **${input.eligibility.overall.replace(/_/g, " ")}**`, ``);
  }
  if (input.bid) {
    lines.push(
      `## Bid decision`, ``,
      `Score ${input.bid.total}/100 — recommendation: **${input.bid.recommendation.replace(/_/g, " ")}**`,
      ``, input.bid.rationale, ``,
      `| Dimension | Score | Note |`, `|---|---|---|`,
      ...input.bid.dimensions.map((d) => `| ${d.label} | ${d.score}/5 | ${d.note.replace(/\|/g, "\\|")} |`),
      ``
    );
  }

  for (const matrix of byType("compliance_matrix")) {
    const requirements = (matrix.content.requirements ?? []) as ExtractedRequirement[];
    const mandatory = requirements.filter((r) => r.mandatory);
    lines.push(
      `## Compliance matrix`, ``,
      `${mandatory.length} mandatory / ${requirements.length - mandatory.length} advisory requirements`, ``,
      `| # | Must | Kind | Requirement | Source |`, `|---|---|---|---|---|`,
      ...requirements.map(
        (r, i) =>
          `| ${i + 1} | ${r.mandatory ? "✔" : "—"} | ${r.kind} | ${r.text.replace(/\|/g, "\\|").slice(0, 140)} | L${r.sourceLocation.line} |`
      ),
      ``
    );
  }

  for (const section of byType("grant_section")) {
    const claims = (section.content.claims ?? []) as SectionClaim[];
    const flagged = claims.filter((c) => c.flagged);
    lines.push(
      `## ${section.title}`, ``,
      String(section.content.body ?? ""), ``,
      `*${Number(section.content.wordCount ?? 0)} words*`, ``
    );
    if (flagged.length) {
      lines.push(`⚠ ${flagged.length} claim(s) in this section lack verified evidence:`, ``);
      for (const claim of flagged) lines.push(`- [${claim.support}] ${claim.text}`);
      lines.push(``);
    }
  }

  for (const budget of byType("budget")) {
    const items = (budget.content.items ?? []) as Array<{
      category: string; description: string; activity: string; quantity: number;
      unitCost: number; amount: number;
    }>;
    lines.push(
      `## Budget`, ``,
      `| Category | Description | Activity | Qty | Unit cost | Amount |`,
      `|---|---|---|---|---|---|`,
      ...items.map(
        (it) =>
          `| ${it.category} | ${it.description.replace(/\|/g, "\\|")} | ${it.activity.replace(/\|/g, "\\|")} | ${it.quantity} | $${it.unitCost.toLocaleString()} | $${it.amount.toLocaleString()} |`
      ),
      ``,
      `**Total: $${(input.budgetTotal ?? 0).toLocaleString()}** (detailed CSV included in package)`,
      ``, `### Budget narrative`, ``, String(budget.content.narrative ?? ""), ``
    );
    const warnings = (budget.content.warnings ?? []) as string[];
    if (warnings.length) lines.push(`⚠ ${warnings.join(" · ")}`, ``);
  }

  for (const lm of byType("logic_model")) {
    const c = lm.content as {
      problem?: string; inputs?: string[]; activities?: string[]; outputs?: string[];
      outcomes?: string[]; impact?: string;
      indicators?: Array<{ outcome: string; indicator: string; baseline: string; target: string; source: string; frequency: string }>;
    };
    lines.push(
      `## Logic model`, ``,
      `**Problem:** ${c.problem ?? ""}`, ``,
      `- Inputs: ${(c.inputs ?? []).join("; ")}`,
      `- Activities: ${(c.activities ?? []).join("; ")}`,
      `- Outputs: ${(c.outputs ?? []).join("; ")}`,
      `- Outcomes: ${(c.outcomes ?? []).join("; ")}`,
      `- Impact: ${c.impact ?? ""}`,
      ``, `### Indicators`, ``,
      `| Outcome | Indicator | Baseline | Target | Source | Frequency |`, `|---|---|---|---|---|---|`,
      ...(c.indicators ?? []).map(
        (i) => `| ${i.outcome} | ${i.indicator} | ${i.baseline} | ${i.target} | ${i.source} | ${i.frequency} |`
      ),
      ``
    );
  }

  for (const review of byType("review_report")) {
    const c = review.content as {
      overall?: number; max?: number;
      reviews?: Array<{ reviewer: string; criterion: string; score: number; maxScore: number; weaknesses: string; fatalFlaw: boolean }>;
      revisionRecommendations?: string[];
    };
    lines.push(
      `## Internal review panel`, ``,
      `Overall: ${c.overall ?? 0}/${c.max ?? 0}`, ``,
      `| Reviewer | Criterion | Score | Fatal flaw |`, `|---|---|---|---|`,
      ...(c.reviews ?? []).map(
        (r) => `| ${r.reviewer} | ${r.criterion.replace(/\|/g, "\\|").slice(0, 100)} | ${r.score}/${r.maxScore} | ${r.fatalFlaw ? "YES" : "no"} |`
      ),
      ``
    );
    if (c.revisionRecommendations?.length) {
      lines.push(`### Revision recommendations`, ``, ...c.revisionRecommendations.map((r) => `- ${r}`), ``);
    }
  }

  for (const report of byType("compliance_report")) {
    const checks = (report.content.checks ?? []) as Array<{ name: string; pass: boolean; detail: string }>;
    lines.push(
      `## Final compliance checklist`, ``,
      ...checks.map((c) => `- [${c.pass ? "x" : " "}] ${c.name} — ${c.detail}`),
      ``
    );
  }

  return lines.join("\n");
}

export function budgetCsv(
  items: Array<{ category: string; description: string; activity: string; quantity: unknown; unit_cost: unknown; amount: unknown }>
): string {
  const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
  return [
    "category,description,activity,quantity,unit_cost,amount",
    ...items.map((it) =>
      [it.category, it.description, it.activity, it.quantity, it.unit_cost, it.amount].map(esc).join(",")
    ),
  ].join("\n");
}
