import { describe, expect, it } from "vitest";
import {
  accumulateGeminiUsage,
  extractGeminiInteractionsUsage,
  extractGeminiUsage,
  getGeminiFinishReasonError,
  toGeminiStreamChunkUsage,
} from "./geminiUsage.js";

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

  it("converts Interactions usage and derives a missing total", () => {
    expect(extractGeminiInteractionsUsage({
      total_input_tokens: 1_000_000,
      total_output_tokens: 1_000_000,
      total_thought_tokens: 20,
      total_tool_use_tokens: 10,
    }, "gemini-3.8-flash")).toEqual({
      input: 1_000_000,
      output: 1_000_000,
      thinking: 20,
      toolUsePromptTokens: 10,
      total: 2_000_000,
      inputCost: 0.75,
      outputCost: 3.75,
      totalCost: 4.5,
    });
  });

  it("maps only blocked finish reasons to user-facing errors", () => {
    expect(getGeminiFinishReasonError([{ finishReason: "SAFETY" }])).toMatch(/safety filters/);
    expect(getGeminiFinishReasonError([{ finishReason: "RECITATION" }])).toMatch(/copyrighted content/);
    expect(getGeminiFinishReasonError([{ finishReason: "STOP" }])).toBeNull();
  });
});
