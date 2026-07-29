import { describe, expect, it } from "vitest";
import { redact, summarize } from "./index.js";

describe("secret redaction (threat T4)", () => {
  it("redacts secret-shaped keys at any depth", () => {
    const out = redact({
      user: "u",
      password: "p@ss",
      nested: { apiKey: "sk-123", authorization: "Bearer abc", ok: 1 },
      list: [{ token: "t" }],
    }) as Record<string, any>;
    expect(out.password).toBe("[REDACTED]");
    expect(out.nested.apiKey).toBe("[REDACTED]");
    expect(out.nested.authorization).toBe("[REDACTED]");
    expect(out.list[0].token).toBe("[REDACTED]");
    expect(out.nested.ok).toBe(1);
  });

  it("summarize truncates and never leaks secrets", () => {
    const s = summarize({ secret: "SUPERSECRET", data: "x".repeat(5000) });
    expect(s).not.toContain("SUPERSECRET");
    expect(s.length).toBeLessThan(900);
  });
});
