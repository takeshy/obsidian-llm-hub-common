import { describe, expect, it, vi } from "vitest";
import {
  GeminiFunctionCallAccumulator,
  getGeminiInteractionStatusError,
  parseGeminiFinalInteractionEvent,
  planGeminiFunctionCalls,
  requestGeminiFunctionCallLimitExtension,
} from "./geminiToolLoop.js";

describe("Gemini tool loop limits", () => {
  it("selects only calls inside the remaining budget", () => {
    expect(planGeminiFunctionCalls(["a", "b", "c"], 3, 5)).toEqual({
      remainingBefore: 2,
      callsToExecute: ["a", "b"],
      skippedCount: 1,
      remainingAfter: 0,
    });
    expect(planGeminiFunctionCalls(["a"], 6, 5)).toEqual({
      remainingBefore: 0,
      callsToExecute: [],
      skippedCount: 1,
      remainingAfter: 0,
    });
  });

  it("extends by the configured default when the callback accepts", async () => {
    const requestLimitExtension = vi.fn().mockResolvedValue(true);
    await expect(requestGeminiFunctionCallLimitExtension(
      { maxFunctionCalls: 10, requestLimitExtension },
      20,
      18,
      20,
      3,
      2,
    )).resolves.toBe(30);
    expect(requestLimitExtension).toHaveBeenCalledWith({
      used: 18,
      currentLimit: 20,
      extensionAmount: 10,
      pendingCalls: 3,
      remaining: 2,
    });
  });

  it("normalizes an explicit extension and preserves the limit when declined", async () => {
    await expect(requestGeminiFunctionCallLimitExtension(
      { requestLimitExtension: async () => 2.9 },
      20,
      19,
      20,
      1,
      1,
    )).resolves.toBe(22);
    await expect(requestGeminiFunctionCallLimitExtension(
      { requestLimitExtension: async () => false },
      20,
      19,
      20,
      1,
      1,
    )).resolves.toBe(20);
  });

  it("assembles fragmented function arguments and removes completed calls", () => {
    const accumulator = new GeminiFunctionCallAccumulator();
    accumulator.start(2, "call-2", "search");
    accumulator.appendArguments(2, '{"query":');
    accumulator.appendArguments(2, '"notes"}');
    expect(accumulator.finish(2)).toEqual({
      id: "call-2",
      name: "search",
      args: { query: "notes" },
    });
    expect(accumulator.finish(2)).toBeNull();
  });

  it("falls back to step.start arguments when streamed JSON is invalid", () => {
    const accumulator = new GeminiFunctionCallAccumulator();
    accumulator.start(1, "call-1", "read", { path: "note.md" });
    accumulator.appendArguments(1, "{invalid");
    expect(accumulator.finish(1)).toEqual({
      id: "call-1",
      name: "read",
      args: { path: "note.md" },
    });
  });

  it("parses final-answer Interactions stream events", () => {
    expect(parseGeminiFinalInteractionEvent({
      event_type: "step.delta",
      delta: { type: "text", text: "answer" },
    })).toEqual({ text: "answer" });
    expect(parseGeminiFinalInteractionEvent({
      event_type: "interaction.created",
      interaction: { id: "interaction-1" },
    })).toEqual({ interactionId: "interaction-1" });
    const usage = { total_tokens: 12 };
    expect(parseGeminiFinalInteractionEvent({
      event_type: "interaction.completed",
      interaction: { usage },
    })).toEqual({ usage });
    expect(parseGeminiFinalInteractionEvent({
      event_type: "step.delta",
      delta: { type: "thought_summary", text: "hidden" },
    })).toEqual({});
  });

  it("normalizes failed Interactions statuses", () => {
    expect(getGeminiInteractionStatusError("completed")).toBeNull();
    expect(getGeminiInteractionStatusError("requires_action")).toBeNull();
    expect(getGeminiInteractionStatusError("failed"))
      .toBe("Response failed (possibly blocked by safety filters)");
    expect(getGeminiInteractionStatusError("cancelled")).toBe("Response cancelled");
    expect(getGeminiInteractionStatusError(undefined)).toBeNull();
  });
});
