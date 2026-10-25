import { describe, expect, it } from "vitest";
import { extractGoogleSearchSuggestions, withGoogleSearchSuggestions } from "./googleSearchSuggestions.js";
import { reduceGeminiInteractionEvent, createGeminiInteractionRound } from "./geminiInteractionStream.js";
import { runGeminiGenerateContentTools } from "./geminiGenerationRunner.js";
import type { StreamChunk } from "./provider.js";
const html = '<style>.container{color:red}</style><a href="https://www.google.com/search?q=test" target="_blank">Search</a>';
async function* events<T>(items: T[]) { yield* items; }
async function collect(stream: AsyncIterable<StreamChunk>) { const items: StreamChunk[] = []; for await (const item of stream) items.push(item); return items; }

describe("Google Search Suggestions", () => {
  it("extracts unmodified HTML from both documented API shapes and completed Interactions", () => {
    expect(extractGoogleSearchSuggestions({ candidates: [{ groundingMetadata: { searchEntryPoint: { renderedContent: html } } }] })).toEqual([html]);
    const step = { type: "google_search_result", result: [{ search_suggestions: html }] };
    expect(extractGoogleSearchSuggestions({ event_type: "step.delta", delta: step })).toEqual([html]);
    expect(extractGoogleSearchSuggestions({ event_type: "interaction.completed", interaction: { steps: [step] } })).toEqual([html]);
    expect(extractGoogleSearchSuggestions({ type: "function_result", result: { search_suggestions: "untrusted" } })).toEqual([]);
    const reduced = reduceGeminiInteractionEvent(createGeminiInteractionRound("native"), { event_type: "step.delta", delta: step });
    expect(reduced.effects).toContainEqual({ type: "search_suggestions", searchSuggestions: [html] });
  });
  it("makes GenerateContent streaming display data available without replacing it with source badges", async () => {
    const chunks = await collect(withGoogleSearchSuggestions(runGeminiGenerateContentTools({
      contents: [], model: "gemini-3.8-flash", traceId: null, generationId: null, maxFunctionCalls: 1, warningThreshold: 0, limitPolicy: { kind: "fixed" },
      create: async () => events([{ candidates: [{ content: { parts: [{ text: "grounded answer" }] }, groundingMetadata: { webSearchQueries: ["q"], searchEntryPoint: { renderedContent: html } } }] }]),
    })));
    expect(chunks.find(chunk => chunk.type === "search_suggestions")?.searchSuggestions).toEqual([html]);
    expect(chunks.findIndex(chunk => chunk.type === "search_suggestions")).toBeLessThan(chunks.findIndex(chunk => chunk.type === "text"));
    expect(chunks.at(-1)?.googleSearchGrounding).toBe(true);
  });
  it("suppresses grounded text and images when the required display data is missing", async () => {
    const chunks = await collect(withGoogleSearchSuggestions(events<StreamChunk>([
      { type: "text", content: "do not reveal" }, { type: "image_generated", generatedImage: { mimeType: "image/png", data: "private" } },
      { type: "web_search_used" }, { type: "done" },
    ])));
    expect(chunks.some(chunk => chunk.type === "text" || chunk.type === "image_generated" || chunk.type === "done")).toBe(false);
    expect(chunks.at(-1)?.error).toContain("Search Suggestions");
  });
});


it("recognizes image-only grounding and refuses its image without display data", async () => {
  const { runGeminiImageGeneration } = await import("./geminiChatRunners.js");
  const chunks = await collect(withGoogleSearchSuggestions(runGeminiImageGeneration({ model: "gemini-3.1-flash-image", traceId: null,
    webSearchEnabled: true, requireSearchSuggestions: true,
    generate: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "private" } }] },
      groundingMetadata: { imageSearchQueries: ["sample image"] } }] }),
  })));
  expect(chunks.some(chunk => chunk.type === "image_generated")).toBe(false);
  expect(chunks.at(-1)?.error).toContain("Search Suggestions");
});
