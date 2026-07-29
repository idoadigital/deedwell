import type { ExtractedRequirement, SectionClaim } from "@deedwell/schemas";

export interface ExportInput {
  opportunityTitle: string;
  funder: string;
  requirements: ExtractedRequirement[];
  section: { title: string; body: string; claims: SectionClaim[]; wordCount: number };
  warnings: string[];
}

/**
 * Markdown export package (DOCX/PDF renderers arrive in Phase 3 behind the
 * same input shape). Includes the mandatory funding disclaimer (BRD §1.4).
 */
export function renderExportMarkdown(input: ExportInput): string {
  const mandatory = input.requirements.filter((r) => r.mandatory);
  const optional = input.requirements.filter((r) => !r.mandatory);
  const flagged = input.section.claims.filter((c) => c.flagged);

  const lines: string[] = [
    `# ${input.opportunityTitle}`,
    ``,
    `Funder: ${input.funder}`,
    ``,
    `> **Disclaimer:** Deedwell helps prepare stronger, more compliant applications.`,
    `> It does not and cannot guarantee a grant award.`,
    ``,
    `## Compliance Matrix`,
    ``,
    `### Mandatory requirements (${mandatory.length})`,
    ...matrixRows(mandatory),
    ``,
    `### Advisory requirements (${optional.length})`,
    ...matrixRows(optional),
    ``,
    `## ${input.section.title}`,
    ``,
    input.section.body,
    ``,
    `*Word count: ${input.section.wordCount}*`,
    ``,
    `## Evidence review`,
    ``,
  ];
  if (flagged.length) {
    lines.push(`⚠ ${flagged.length} claim(s) lack verified or user-certified evidence:`, ``);
    for (const claim of flagged) {
      lines.push(`- [${claim.support}] ${claim.text}`);
    }
  } else {
    lines.push(`All claims are backed by verified or user-certified facts.`);
  }
  if (input.warnings.length) {
    lines.push(``, `## Warnings`, ``, ...input.warnings.map((w) => `- ${w}`));
  }
  return lines.join("\n");
}

function matrixRows(reqs: ExtractedRequirement[]): string[] {
  if (!reqs.length) return ["_None detected._"];
  return [
    `| # | Kind | Requirement | Source | Word limit |`,
    `|---|------|-------------|--------|------------|`,
    ...reqs.map(
      (r, i) =>
        `| ${i + 1} | ${r.kind} | ${r.text.replace(/\|/g, "\\|").slice(0, 160)} | line ${r.sourceLocation.line} | ${r.wordLimit ?? "—"} |`
    ),
  ];
}
