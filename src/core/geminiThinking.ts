import type { ReasoningEffort } from "./provider.js";

export type GeminiThinkingLevel = "minimal" | "low" | "medium" | "high";

/** Models whose API does not permit thinking to be disabled. */
export function isGeminiThinkingRequired(model: string): boolean {
  const lower = model.toLowerCase();
  return lower.includes("gemini-3-pro") || lower.includes("gemini-3.1-pro");
}

/** Thinking levels exposed by the chat UI for a Gemini model. */
export function getGeminiReasoningEffortOptions(
  model: string,
  isImageGenerationModel = false,
): ReasoningEffort[] {
  const lower = model.toLowerCase();
  if (lower.includes("gemma-4") || isImageGenerationModel) return [];
  if (isGeminiThinkingRequired(model)) return ["default", "low", "medium", "high"];
  if (lower.includes("gemini-3")) return ["default", "minimal", "low", "medium", "high"];
  return [];
}

/** Build thinkingConfig for Gemini's GenerateContent and SDK Chat APIs. */
export function buildGeminiThinkingConfig(
  model: string,
  enableThinking: boolean | undefined,
  reasoningEffort?: ReasoningEffort,
): Record<string, unknown> | undefined {
  const lower = model.toLowerCase();
  if (lower.includes("gemma-4")) return undefined;

  if (reasoningEffort === "default") return undefined;
  const explicitLevel = reasoningEffort;
  if (explicitLevel) return { includeThoughts: true, thinkingLevel: explicitLevel.toUpperCase() };
  if (enableThinking === undefined) return undefined;

  if (lower.includes("gemini-3.8-flash")) {
    return enableThinking
      ? { includeThoughts: true, thinkingLevel: "HIGH" }
      : { thinkingLevel: "LOW" };
  }
  if (lower.includes("gemini-3.5-flash-lite")) {
    return enableThinking ? { includeThoughts: true, thinkingLevel: "HIGH" } : undefined;
  }
  if (!enableThinking && !isGeminiThinkingRequired(model)) return { thinkingBudget: 0 };
  return { includeThoughts: true };
}

/** Resolve thinking_level for Gemini's Interactions API. */
export function resolveGeminiThinkingLevel(
  model: string,
  enableThinking: boolean | undefined,
  reasoningEffort?: ReasoningEffort,
): GeminiThinkingLevel | undefined {
  const lower = model.toLowerCase();
  if (lower.includes("gemma-4")) return undefined;
  if (reasoningEffort === "default") return undefined;
  if (reasoningEffort && reasoningEffort !== "none"
    && reasoningEffort !== "xhigh" && reasoningEffort !== "max") {
    return reasoningEffort;
  }
  if (enableThinking === undefined) return undefined;
  if (lower.includes("gemini-3.8-flash")) return enableThinking ? "high" : "low";
  if (isGeminiThinkingRequired(model)) return "high";
  return enableThinking ? "high" : "minimal";
}
