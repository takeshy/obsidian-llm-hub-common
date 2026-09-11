import { describe, expect, it } from "vitest";
import { findTextContexts, selectTextLines } from "./textLines.js";

describe("text line helpers", () => {
  it("does not count the sentinel after a final newline as a line", () => {
    expect(selectTextLines("one\ntwo\n", 2)).toEqual({ content: "two\n", startLine: 2, endLine: 2, totalLines: 2 });
  });

  it("keeps separate non-overlapping context windows", () => {
    expect(findTextContexts("hit\na\nb\nc\nhit", "hit", 0, 1)).toEqual([
      { startLine: 1, endLine: 2, content: "hit\na" },
      { startLine: 5, endLine: 5, content: "hit" },
    ]);
  });
});
