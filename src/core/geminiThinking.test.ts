import { describe, expect, it } from "vitest";
import {
  buildGeminiThinkingConfig,
  getGeminiReasoningEffortOptions,
  resolveGeminiThinkingLevel,
} from "./geminiThinking.js";

describe("Gemini thinking configuration", () => {
  it("lets an explicit effort override the legacy toggle", () => {
    expect(buildGeminiThinkingConfig("gemini-3.8-flash", false, "medium")).toEqual({
      includeThoughts: true,
      thinkingLevel: "MEDIUM",
    });
    expect(resolveGeminiThinkingLevel("gemini-3.5-flash-lite", true, "minimal")).toBe("minimal");
  });

  it("leaves default reasoning to the provider", () => {
    expect(buildGeminiThinkingConfig("gemini-3.8-flash", undefined, "default")).toBeUndefined();
    expect(buildGeminiThinkingConfig("gemini-3.8-flash", false, "default")).toBeUndefined();
    expect(resolveGeminiThinkingLevel("gemini-3.8-flash", undefined, "default")).toBeUndefined();
    expect(resolveGeminiThinkingLevel("gemini-3.8-flash", false, "default")).toBeUndefined();
  });

  it("preserves model-specific binary toggle behavior", () => {
    expect(buildGeminiThinkingConfig("gemini-3.8-flash", false)).toEqual({ thinkingLevel: "LOW" });
    expect(buildGeminiThinkingConfig("gemini-3.5-flash-lite", false)).toBeUndefined();
    expect(buildGeminiThinkingConfig("gemini-3.1-pro-preview", false)).toEqual({ includeThoughts: true });
    expect(resolveGeminiThinkingLevel("gemini-3.1-pro-preview", false)).toBe("high");
  });

  it("does not configure Gemma and does not offer effort for image models", () => {
    expect(buildGeminiThinkingConfig("gemma-4-31b-it", true, "high")).toBeUndefined();
    expect(getGeminiReasoningEffortOptions("gemini-3.8-flash")).toEqual(["default", "minimal", "low", "medium", "high"]);
    expect(getGeminiReasoningEffortOptions("gemini-3.1-pro-preview")).toEqual(["default", "low", "medium", "high"]);
    expect(getGeminiReasoningEffortOptions("gemini-3.1-flash-image", true)).toEqual([]);
  });
});
