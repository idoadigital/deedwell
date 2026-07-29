/**
 * Secret redaction for anything that reaches logs, audit metadata, or tool
 * invocation summaries. Threat model T4: secrets must never appear in telemetry.
 */

const SECRET_KEY_PATTERN =
  /(password|passwd|secret|token|api[-_]?key|authorization|cookie|credential|private[-_]?key)/i;

export function redact<T>(value: T): T {
  return redactInner(value, 0) as T;
}

function redactInner(value: unknown, depth: number): unknown {
  if (depth > 8) return "[depth-limit]";
  if (Array.isArray(value)) return value.map((v) => redactInner(v, depth + 1));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_PATTERN.test(k) ? "[REDACTED]" : redactInner(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Pino redact paths for the HTTP layer. */
export const PINO_REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "*.password",
  "*.token",
  "*.tokenHash",
  "*.secret",
  "*.apiKey",
];

/** Truncate arbitrary payloads before persisting them into audit rows. */
export function summarize(value: unknown, maxLen = 800): string {
  let s: string;
  try {
    s = typeof value === "string" ? value : JSON.stringify(redact(value));
  } catch {
    s = "[unserializable]";
  }
  return s.length > maxLen ? `${s.slice(0, maxLen)}…[truncated]` : s;
}
