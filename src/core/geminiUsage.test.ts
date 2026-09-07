import { describe, expect, it } from "vitest";
import { accumulateGeminiUsage, extractGeminiUsage, getGeminiFinishReasonError, toGeminiStreamChunkUsage } from "./geminiUsage.js";

describe("Gemini usage", () => {
  it("calculates token and grounding costs once", () => {
    expect(extractGeminiUsage({ promptTokenCount: 1_000_000, candidatesTokenCount: 1_000_000, totalTokenCount: 2_000_000 }, {
      model: "gemini-3.8-flash", webSearchUsed: true,
    })).toMatchObject({ inputCost: 0.75, outputCost: 3.75, totalCost: 4.514 });
  });

  it("accumulates optional counters without dropping earlier rounds", () => {
    const total = extractGeminiUsage({ promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 5, thoughtsTokenCount: 1 })!;
    accumulateGeminiUsage(total, { input: 4, output: 5, total: 9, toolUsePromptTokens: 2 });
    expect(total).toMatchObject({ input: 6, output: 8, thinking: 1, toolUsePromptTokens: 2, total: 14 });
    expect(toGeminiStreamChunkUsage(total)).toEqual({ inputTokens: 6, outputTokens: 8, thinkingTokens: 1, totalTokens: 14, totalCost: undefined });
  });

  it("maps only blocked finish reasons to user-facing errors", () => {
    expect(getGeminiFinishReasonError([{ finishReason: "SAFETY" }])).toMatch(/safety filters/);
    expect(getGeminiFinishReasonError([{ finishReason: "RECITATION" }])).toMatch(/copyrighted content/);
    expect(getGeminiFinishReasonError([{ finishReason: "STOP" }])).toBeNull();
  });
});
