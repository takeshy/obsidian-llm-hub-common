import type { TracingUsage } from "./tracingHooks.js";
import type { StreamChunkUsage } from "./usage.js";

export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  thoughtsTokenCount?: number;
  toolUsePromptTokenCount?: number;
}

export interface ExtractGeminiUsageOptions {
  model?: string;
  webSearchUsed?: boolean;
}

export interface GeminiInteractionsUsage {
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_thought_tokens?: number;
  total_tool_use_tokens?: number;
  total_tokens?: number;
}

export const GEMINI_MODEL_PRICING: Readonly<Record<string, Readonly<{ input: number; output: number }>>> = {
  "gemini-3.8-flash": { input: 0.75 / 1e6, output: 3.75 / 1e6 },
  "gemini-3.5-flash-lite": { input: 0.30 / 1e6, output: 2.50 / 1e6 },
  "gemini-3.1-pro-preview": { input: 2.00 / 1e6, output: 12.00 / 1e6 },
  "gemini-3.1-pro-preview-customtools": { input: 2.00 / 1e6, output: 12.00 / 1e6 },
  "gemini-3-pro-image": { input: 2.00 / 1e6, output: 120.00 / 1e6 },
  "gemini-3.1-flash-image": { input: 0.50 / 1e6, output: 60.00 / 1e6 },
  "gemini-3.1-flash-lite-image": { input: 0.25 / 1e6, output: 30.00 / 1e6 },
};

export const GEMINI_SEARCH_GROUNDING_COST: Readonly<Record<string, number>> = {
  "gemini-3.8-flash": 14 / 1000,
  "gemini-3.1-pro-preview": 14 / 1000,
  "gemini-3.1-pro-preview-customtools": 14 / 1000,
  "gemini-3-pro-image": 14 / 1000,
  "gemini-3.1-flash-image": 14 / 1000,
  "gemini-3.5-flash-lite": 14 / 1000,
};

export function extractGeminiUsage(
  usage: GeminiUsageMetadata | undefined,
  options?: ExtractGeminiUsageOptions,
): TracingUsage | undefined {
  if (!usage) return undefined;
  const model = options?.model;
  const inputTokens = usage.promptTokenCount ?? 0;
  const outputTokens = usage.candidatesTokenCount ?? 0;
  const thinkingTokens = usage.thoughtsTokenCount ?? 0;
  const toolUseTokens = usage.toolUsePromptTokenCount ?? 0;
  const pricing = model ? GEMINI_MODEL_PRICING[model] : undefined;
  const inputCost = pricing ? inputTokens * pricing.input : undefined;
  const outputCost = pricing ? outputTokens * pricing.output : undefined;
  let totalCost = inputCost !== undefined && outputCost !== undefined ? inputCost + outputCost : undefined;
  if (options?.webSearchUsed && model && GEMINI_SEARCH_GROUNDING_COST[model] !== undefined) {
    totalCost = (totalCost ?? 0) + GEMINI_SEARCH_GROUNDING_COST[model];
  }
  return {
    input: usage.promptTokenCount,
    output: usage.candidatesTokenCount,
    thinking: thinkingTokens > 0 ? thinkingTokens : undefined,
    toolUsePromptTokens: toolUseTokens > 0 ? toolUseTokens : undefined,
    total: usage.totalTokenCount,
    inputCost,
    outputCost,
    totalCost,
  };
}

export function extractGeminiInteractionsUsage(
  usage: GeminiInteractionsUsage | undefined,
  model?: string,
): TracingUsage | undefined {
  if (!usage) return undefined;
  const inputTokens = usage.total_input_tokens ?? 0;
  const outputTokens = usage.total_output_tokens ?? 0;
  const thinkingTokens = usage.total_thought_tokens ?? 0;
  const toolUseTokens = usage.total_tool_use_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? inputTokens + outputTokens;
  const pricing = model ? GEMINI_MODEL_PRICING[model] : undefined;
  const inputCost = pricing ? inputTokens * pricing.input : undefined;
  const outputCost = pricing ? outputTokens * pricing.output : undefined;
  const totalCost = inputCost !== undefined && outputCost !== undefined ? inputCost + outputCost : undefined;

  return {
    input: inputTokens || undefined,
    output: outputTokens || undefined,
    thinking: thinkingTokens > 0 ? thinkingTokens : undefined,
    toolUsePromptTokens: toolUseTokens > 0 ? toolUseTokens : undefined,
    total: totalTokens || undefined,
    inputCost,
    outputCost,
    totalCost,
  };
}

export function accumulateGeminiUsage(total: TracingUsage, round: TracingUsage): void {
  total.input = (total.input ?? 0) + (round.input ?? 0);
  total.output = (total.output ?? 0) + (round.output ?? 0);
  if (round.thinking !== undefined) total.thinking = (total.thinking ?? 0) + round.thinking;
  if (round.toolUsePromptTokens !== undefined) total.toolUsePromptTokens = (total.toolUsePromptTokens ?? 0) + round.toolUsePromptTokens;
  total.total = (total.total ?? 0) + (round.total ?? 0);
  if (round.inputCost !== undefined) total.inputCost = (total.inputCost ?? 0) + round.inputCost;
  if (round.outputCost !== undefined) total.outputCost = (total.outputCost ?? 0) + round.outputCost;
  if (round.totalCost !== undefined) total.totalCost = (total.totalCost ?? 0) + round.totalCost;
}

export function toGeminiStreamChunkUsage(usage: TracingUsage | undefined): StreamChunkUsage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    thinkingTokens: usage.thinking,
    totalTokens: usage.total,
    totalCost: usage.totalCost,
  };
}

export function getGeminiFinishReasonError(candidates: Array<{ finishReason?: string }> | undefined): string | null {
  const reason = candidates?.[0]?.finishReason;
  if (reason === "SAFETY") return "Response blocked by safety filters. Please rephrase your message.";
  if (reason === "RECITATION") return "Response blocked due to potential recitation of copyrighted content.";
  return null;
}
