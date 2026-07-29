import type { ModelProvider, ModelRequest, ModelResponse } from "./index.js";
import type {
  ExtractedRequirement,
  OrgFact,
  RequirementsExtractionOutput,
  SectionClaim,
  SectionDraftOutput,
} from "@deedwell/schemas";

/**
 * ============================ MOCK IMPLEMENTATION ===========================
 * Deterministic, rule-based stand-in for a real model provider (ADR-0003).
 * It exists so the harness — schemas, retries, budgets, gateways, approvals,
 * durability — can be built and tested hermetically. It is NOT a language
 * model and its content quality is not representative of the product.
 * ==========================================================================
 */
export class MockModelProvider implements ModelProvider {
  readonly name = "mock";

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const text =
      request.outputSchemaRef === "requirements_extraction"
        ? JSON.stringify(extractRequirements(request))
        : JSON.stringify(draftSection(request));
    const inputChars =
      request.system.length +
      request.task.length +
      request.dataBlocks.reduce((n, b) => n + b.content.length, 0);
    return { text, tokensEstimated: Math.ceil((inputChars + text.length) / 4) };
  }
}

const MANDATORY = /\b(must|shall|required|require[sd]?)\b/i;
const ADVISORY = /\b(should|encouraged|recommended|may include)\b/i;

const KIND_RULES: Array<[RegExp, ExtractedRequirement["kind"]]> = [
  [/\beligib|501\s*\(\s*c\s*\)|nonprofit status|registered|tax[- ]exempt|incorporat/i, "eligibility"],
  [/\bbudget|cost|match(ing)? funds?|indirect|line[- ]item/i, "budget"],
  [/\battach|upload|letter of support|form [A-Z0-9-]+|appendix/i, "attachment"],
  [/\bfont|margin|page limit|single[- ]spaced|double[- ]spaced|file (format|type)|pdf format/i, "formatting"],
  [/\bdeadline|due (by|date|no later)|submit(ted)? by/i, "deadline"],
  [/\bnarrative|describe|statement|section|explain|demonstrate/i, "narrative"],
];

function classify(line: string): ExtractedRequirement["kind"] {
  for (const [re, kind] of KIND_RULES) if (re.test(line)) return kind;
  return "other";
}

function extractRequirements(request: ModelRequest): RequirementsExtractionOutput {
  const doc = request.dataBlocks.find((b) => b.label === "document")?.content ?? "";
  const lines = doc.split(/\r?\n/);
  const requirements: ExtractedRequirement[] = [];

  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (line.length < 12) return;
    const mandatory = MANDATORY.test(line);
    if (!mandatory && !ADVISORY.test(line)) return;
    const wordLimitMatch = line.match(/(\d{2,6})\s*words?\b/i);
    requirements.push({
      text: line.slice(0, 4000),
      kind: classify(line),
      mandatory,
      sourceLocation: { line: idx + 1, quote: line.slice(0, 2000) },
      wordLimit: wordLimitMatch ? Number(wordLimitMatch[1]) : null,
    });
  });

  if (requirements.length === 0) {
    // Schema requires >= 1; surface an explicit "nothing found" requirement so
    // the workflow can fail loudly rather than invent content.
    requirements.push({
      text: "NO REQUIREMENTS DETECTED — document may not be a grant announcement",
      kind: "other",
      mandatory: false,
      sourceLocation: { line: 1, quote: lines[0]?.slice(0, 200) || "(empty document)" },
      wordLimit: null,
    });
  }

  return {
    requirements,
    documentSummary: `Detected ${requirements.length} candidate requirement(s) across ${lines.length} lines. [mock provider]`,
  };
}

function draftSection(request: ModelRequest): SectionDraftOutput {
  const facts: OrgFact[] = JSON.parse(
    request.dataBlocks.find((b) => b.label === "org_facts")?.content ?? "[]"
  );
  const requirements: Array<{ text: string; wordLimit: number | null }> = JSON.parse(
    request.dataBlocks.find((b) => b.label === "requirements")?.content ?? "[]"
  );
  const titleMatch = request.task.match(/section titled "([^"]+)"/i);
  const title = titleMatch?.[1] ?? "Draft Section";

  const claims: SectionClaim[] = [];
  const paragraphs: string[] = [];

  for (const fact of facts) {
    const sentence = `Our organization's ${fact.key.replace(/_/g, " ")} is ${fact.value}.`;
    const supported = fact.status === "verified" || fact.status === "user_certified";
    claims.push({
      text: sentence,
      factKey: fact.key,
      support: fact.status,
      flagged: !supported,
    });
    paragraphs.push(sentence);
  }

  // A deliberately unsupported claim: real models produce these; the harness
  // must catch and flag them rather than let them pass silently.
  const unsupported = `This program is projected to reach significantly more participants than comparable initiatives.`;
  claims.push({ text: unsupported, factKey: null, support: "unsupported", flagged: true });
  paragraphs.push(unsupported);

  paragraphs.push(
    `This section responds to ${requirements.length} extracted requirement(s). [mock provider draft]`
  );
  const body = paragraphs.join("\n\n");
  return {
    title,
    body,
    claims,
    wordCount: body.split(/\s+/).filter(Boolean).length,
  };
}
