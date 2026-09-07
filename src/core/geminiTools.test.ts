import { describe, expect, it } from "vitest";
import {
  collectGeminiWebSources,
  sanitizeGeminiFunctionResult,
  serializeGeminiFunctionResult,
} from "./geminiTools.js";

describe("Gemini tool helpers", () => {
  it("replaces nested empty arrays with null", () => {
    expect(sanitizeGeminiFunctionResult({ items: [], nested: [{ values: [] }] })).toEqual({
      items: null,
      nested: [{ values: null }],
    });
  });

  it("serializes strings directly and safely handles circular values", () => {
    expect(serializeGeminiFunctionResult("result")).toBe("result");
    expect(serializeGeminiFunctionResult("")).toBe("null");
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(serializeGeminiFunctionResult(circular)).toBe("null");
  });

  it("collects and deduplicates nested URLs and attribution anchors", () => {
    const sources = [{ title: "Existing", url: "https://example.com/a" }];
    collectGeminiWebSources({
      results: [
        { uri: "https://example.com/a", name: "Duplicate" },
        { link: "https://example.com/b", title: "Result B" },
      ],
    }, sources);
    collectGeminiWebSources('<a href="https://example.com/c?a=1&amp;b=2"><b>Result</b> C</a>', sources);

    expect(sources).toEqual([
      { title: "Existing", url: "https://example.com/a" },
      { title: "Result B", url: "https://example.com/b" },
      { title: "Result C", url: "https://example.com/c?a=1&b=2" },
    ]);
  });
});
