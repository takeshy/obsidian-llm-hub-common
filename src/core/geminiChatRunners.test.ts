import { afterEach, describe, expect, it, vi } from "vitest";
import { extractGeminiResearchText, runGeminiChat, runGeminiDeepResearch, runGeminiImageGeneration, runGeminiTextStream } from "./geminiChatRunners.js";
import { tracing } from "./tracingHooks.js";
import type { StreamChunk } from "./provider.js";
async function* stream<T>(chunks: T[]) { yield* chunks; }
async function collect(generator: AsyncIterable<StreamChunk>) {
  const chunks: StreamChunk[] = [];
  for await (const chunk of generator) chunks.push(chunk);
  return chunks;
}
afterEach(() => vi.restoreAllMocks());
const model = "gemini-3.8-flash";

describe("Gemini chat runners", () => {
  it("returns chat text with usage and rethrows blocked/API errors", async () => {
    const end = vi.spyOn(tracing, "generationEnd");
    expect(await runGeminiChat({ model, generate: async () => ({ text: "answer", usageMetadata: { totalTokenCount: 5 } }) })).toBe("answer");
    expect(end).toHaveBeenCalledWith(null, expect.objectContaining({ output: "answer", usage: expect.objectContaining({ total: 5 }) }));
    await expect(runGeminiChat({ model, generate: async () => ({ candidates: [{ finishReason: "SAFETY" }] }) })).rejects.toThrow("safety");
    const error = new Error("network");
    await expect(runGeminiChat({ model, generate: async () => { throw error; } })).rejects.toBe(error);
  });
  it.each(["chatStream", "generateWorkflowStream"] as const)("streams %s with the correct thought policy and terminal usage", async kind => {
    const chunks = await collect(runGeminiTextStream({ model, kind, generate: async () => stream([
      { text: "answer", candidates: [{ content: { parts: [{ thought: true, text: "thinking" }] } }] },
      { usageMetadata: { totalTokenCount: 5 } },
    ]) }));
    expect(chunks.filter(chunk => chunk.type === "thinking")).toHaveLength(kind === "chatStream" ? 0 : 1);
    expect(chunks.at(-1)).toMatchObject({ type: "done", usage: { totalTokens: 5 } });
  });
  it.each(["chatStream", "generateWorkflowStream"] as const)("does not call empty %s successful", async kind => {
    const chunks = await collect(runGeminiTextStream({ model, kind, generate: async () => stream([]) }));
    expect(chunks).toEqual([{ type: "error", error: "No response received from API (possible server error)" }]);
  });
  it("retains usage on stream failure and suppresses blocked text", async () => {
    const end = vi.spyOn(tracing, "generationEnd");
    const chunks = await collect(runGeminiTextStream({ model, kind: "chatStream", generate: async () => stream([
      { usageMetadata: { totalTokenCount: 4 }, text: "blocked", candidates: [{ finishReason: "RECITATION" }] },
    ]) }));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe("error");
    expect(end).toHaveBeenCalledWith(null, expect.objectContaining({ usage: expect.objectContaining({ total: 4 }) }));
  });
  it("extracts image and text parts in order, ignoring incomplete image data", async () => {
    const chunks = await collect(runGeminiImageGeneration({ model, webSearchEnabled: true, generate: async () => ({
      candidates: [{ content: { parts: [{ text: "caption" }, { inlineData: { mimeType: "image/png", data: "abc" } }, { inlineData: { mimeType: "image/png" } }] } }],
      usageMetadata: { totalTokenCount: 3 },
    }) }));
    expect(chunks.slice(0, -1)).toEqual([{ type: "web_search_used" }, { type: "text", content: "caption" }, { type: "image_generated", generatedImage: { mimeType: "image/png", data: "abc" } }]);
    expect(chunks.at(-1)).toMatchObject({ type: "done", usage: { totalTokens: 3 } });
  });
  it("never emits image/search/done after a blocked image response", async () => {
    const chunks = await collect(runGeminiImageGeneration({ model, webSearchEnabled: true, generate: async () => ({ candidates: [{ finishReason: "SAFETY" }] }) }));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe("error");
  });
});

describe("Gemini research polling", () => {
  const base = { query: "question", create: async () => ({ id: "research" }), delay: vi.fn().mockResolvedValue(undefined) };
  it("prefers output_text and falls back to only model-output text parts", () => {
    const steps = [{ type: "model_output", content: [{ type: "text", text: "a" }, { type: "image", text: "ignore" }, { type: "text", text: "b" }] }];
    expect(extractGeminiResearchText({ output_text: "sdk", steps })).toBe("sdk");
    expect(extractGeminiResearchText({ steps })).toBe("ab");
  });
  it("polls until complete, then emits text, usage and interaction ID", async () => {
    const get = vi.fn().mockResolvedValueOnce({ status: "in_progress" }).mockResolvedValueOnce({ status: "completed", output_text: "report", usage: { total_tokens: 8 } });
    const chunks = await collect(runGeminiDeepResearch({ ...base, get }));
    expect(get.mock.calls).toEqual([["research"], ["research"]]);
    expect(base.delay).toHaveBeenCalledWith(10000);
    expect(chunks.at(-2)).toEqual({ type: "text", content: "report" });
    expect(chunks.at(-1)).toMatchObject({ type: "done", interactionId: "research", usage: { totalTokens: 8 } });
  });
  it.each(["failed", "cancelled"])("terminates on %s", async status => {
    const get = vi.fn().mockResolvedValue({ status });
    const chunks = await collect(runGeminiDeepResearch({ ...base, get }));
    expect(get).toHaveBeenCalledTimes(1);
    expect(chunks.at(-1)).toEqual({ type: "error", error: `Deep Research ${status}` });
  });
  it("stops after 180 polls and reports timeout", async () => {
    const get = vi.fn().mockResolvedValue({ status: "in_progress" });
    const chunks = await collect(runGeminiDeepResearch({ ...base, get }));
    expect(get).toHaveBeenCalledTimes(180);
    expect(chunks.at(-1)).toEqual({ type: "error", error: "Deep Research timed out after 30 minutes" });
  });
  it("stops polling when the consumer closes the iterator", async () => {
    const get = vi.fn();
    const generator = runGeminiDeepResearch({ ...base, get });
    await generator.next();
    await generator.return();
    expect(get).not.toHaveBeenCalled();
  });
});
