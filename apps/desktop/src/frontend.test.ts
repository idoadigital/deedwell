import { describe, expect, it } from "vitest";
import { createSSEParser } from "./sse";
import { diffLines } from "./diff";

describe("SSE incremental parser", () => {
  it("assembles events split across arbitrary chunk boundaries", () => {
    const parse = createSSEParser();
    expect(parse('data: {"a"')).toEqual([]);
    expect(parse(':1}\n\ndata: {"b":2}\n')).toEqual(['{"a":1}']);
    expect(parse("\n")).toEqual(['{"b":2}']);
  });

  it("ignores comment/heartbeat lines and joins multi-line data", () => {
    const parse = createSSEParser();
    expect(parse(": connected\n\n")).toEqual([]);
    expect(parse("data: line1\ndata: line2\n\n")).toEqual(["line1\nline2"]);
  });
});

describe("line diff for artifact versions", () => {
  it("marks added, removed, and unchanged lines", () => {
    const out = diffLines("a\nb\nc", "a\nx\nc");
    expect(out).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "x" },
      { kind: "same", text: "c" },
    ]);
  });

  it("handles pure additions and empty inputs", () => {
    expect(diffLines("", "new").some((l) => l.kind === "added")).toBe(true);
    expect(diffLines("old", "old")).toEqual([{ kind: "same", text: "old" }]);
  });
});
