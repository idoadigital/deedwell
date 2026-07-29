/**
 * Dangerous-instruction detection for uploaded/retrieved content (threat T2).
 * Detection never blocks parsing — content is already treated as inert data —
 * but flagged documents are surfaced to the user and recorded on the
 * opportunity so a human sees that the source tried to steer the system.
 */

const INJECTION_PATTERNS: Array<[RegExp, string]> = [
  [/ignore\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+instructions/i, "attempts to override prior instructions"],
  [/disregard\s+(the\s+)?(system|previous|above)/i, "attempts to disregard system rules"],
  [/you\s+are\s+now\s+(a|an|in)\b/i, "attempts to reassign the assistant's role"],
  [/reveal\s+.{0,40}(secret|password|api\s*key|system\s*prompt|credentials)/i, "asks for secrets or hidden prompts"],
  [/system\s*prompt/i, "references the system prompt"],
  [/\bdo\s+not\s+tell\s+the\s+user\b/i, "asks to hide behavior from the user"],
  [/<\s*script\b/i, "contains embedded script markup"],
];

export interface InjectionWarning {
  line: number;
  pattern: string;
  excerpt: string;
}

export function scanForInjection(text: string): InjectionWarning[] {
  const warnings: InjectionWarning[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, idx) => {
    for (const [re, description] of INJECTION_PATTERNS) {
      if (re.test(line)) {
        warnings.push({ line: idx + 1, pattern: description, excerpt: line.trim().slice(0, 200) });
        break;
      }
    }
  });
  return warnings;
}
