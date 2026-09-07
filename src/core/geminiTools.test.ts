import { describe, expect, it } from "vitest";
import {
  collectGeminiWebSources,
  extractGeminiGroundingWebSearch,
  prepareGeminiToolResult,
  parseGeminiGenerateContentParts,
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

  it("prepares a safe, bounded tool trace and reusable serialized result", () => {
    const prepared = prepareGeminiToolResult("search", { query: "notes" }, { text: "abcdefgh" }, 5);
    expect(prepared.serializedResult).toBe('{"text":"abcdefgh"}');
    expect(prepared.trace).toBe(
      '\n[tool_call: search({"query":"notes"})]\n[tool_result: {"tex...]\n',
    );

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(prepareGeminiToolResult("read", {}, circular).serializedResult).toBe("null");
  });

  it("extracts unique grounding sources and detects query-only searches", () => {
    expect(extractGeminiGroundingWebSearch({
      candidates: [{
        groundingMetadata: {
          webSearchQueries: ["query"],
          groundingChunks: [
            { web: { uri: "https://example.com/a", title: "A" } },
            { web: { uri: "https://example.com/a", title: "Duplicate" } },
            { web: { uri: "https://example.com/b" } },
          ],
        },
      }],
    })).toEqual({
      used: true,
      sources: [
        { title: "A", url: "https://example.com/a" },
        { title: "https://example.com/b", url: "https://example.com/b" },
      ],
    });
    expect(extractGeminiGroundingWebSearch({
      candidates: [{ groundingMetadata: { webSearchQueries: ["query"] } }],
    })).toEqual({ used: true, sources: [] });
  });

  it("classifies text, thinking, function calls, and Search tool responses", () => {
    expect(parseGeminiGenerateContentParts([
      { text: "answer" },
      { text: "reasoning", thought: true, thoughtSignature: "keep-on-original-part" },
      { functionCall: { id: "call-1", name: "search", args: { query: "notes" } } },
      { functionCall: { name: "invalid-args", args: "not-an-object" } },
      { toolResponse: { toolType: "GOOGLE_SEARCH_WEB", response: { url: "https://example.com" } } },
    ])).toEqual({
      textSegments: [
        { type: "text", content: "answer" },
        { type: "thinking", content: "reasoning" },
      ],
      functionCalls: [
        { id: "call-1", name: "search", args: { query: "notes" } },
        { name: "invalid-args", args: {} },
      ],
      webSearchResponses: [{ url: "https://example.com" }],
    });
  });
});
