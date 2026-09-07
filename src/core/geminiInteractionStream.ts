import type { RagContext, WebSearchSource } from "./message.js";
import {
  collectGeminiInteractionAnnotationSources,
  collectGeminiInteractionFileSearchResult,
  collectGeminiInteractionStepSources,
} from "./geminiInteractions.js";
import { GeminiFunctionCallAccumulator, getGeminiInteractionStatusError, type GeminiPendingFunctionCall } from "./geminiToolLoop.js";
import { collectGeminiWebSources } from "./geminiTools.js";

/** Required policy: native File Search and pre-retrieved RAG have different source contracts. */
export type GeminiInteractionSearchPolicy = "native" | "pre-retrieved";

export interface GeminiInteractionRoundState {
  searchPolicy: GeminiInteractionSearchPolicy;
  hasReceivedEvent: boolean;
  interactionId?: string;
  usage?: unknown;
  functionCalls: GeminiPendingFunctionCall[];
  pendingCalls: Record<number, { call: GeminiPendingFunctionCall; arguments: string }>;
  sources: string[];
  contexts: RagContext[];
  webSources: WebSearchSource[];
  fileSearchUsed: boolean;
  webSearchUsed: boolean;
}

export type GeminiInteractionStreamEffect =
  | { type: "text" | "thinking"; content: string }
  | { type: "web_search_used" }
  | { type: "error"; error: string };

export function createGeminiInteractionRound(searchPolicy: GeminiInteractionSearchPolicy): GeminiInteractionRoundState {
  return {
    searchPolicy, hasReceivedEvent: false, functionCalls: [], pendingCalls: {},
    sources: [], contexts: [], webSources: [], fileSearchUsed: false, webSearchUsed: false,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** Pure per-round reducer. The host owns yielding, tracing, pricing and API calls. */
export function reduceGeminiInteractionEvent(
  previous: GeminiInteractionRoundState,
  raw: unknown,
): { state: GeminiInteractionRoundState; effects: GeminiInteractionStreamEffect[] } {
  const state: GeminiInteractionRoundState = {
    ...previous, hasReceivedEvent: true,
    functionCalls: [...previous.functionCalls], pendingCalls: { ...previous.pendingCalls },
    sources: [...previous.sources], contexts: [...previous.contexts], webSources: [...previous.webSources],
  };
  const effects: GeminiInteractionStreamEffect[] = [];
  const event = record(raw);
  const index = typeof event.index === "number" ? event.index : undefined;
  const nativeSearch = state.searchPolicy === "native";
  switch (event.event_type) {
    case "interaction.created": {
      const id = record(event.interaction).id;
      if (typeof id === "string") state.interactionId = id;
      break;
    }
    case "step.start": {
      const step = record(event.step);
      if (step.type === "function_call" && index !== undefined && typeof step.id === "string" && typeof step.name === "string") {
        state.pendingCalls[index] = {
          call: { id: step.id, name: step.name, args: record(step.arguments) }, arguments: "",
        };
      }
      if (nativeSearch && step.type === "file_search_call") state.fileSearchUsed = true;
      break;
    }
    case "step.delta": {
      const delta = record(event.delta);
      switch (delta.type) {
        case "text":
          if (typeof delta.text === "string" && delta.text) effects.push({ type: "text", content: delta.text });
          break;
        case "thought_summary": {
          const text = record(delta.content).text;
          if (typeof text === "string" && text) effects.push({ type: "thinking", content: text });
          break;
        }
        case "arguments_delta": {
          const pending = index !== undefined ? state.pendingCalls[index] : undefined;
          if (index !== undefined && pending && typeof delta.arguments === "string") {
            state.pendingCalls[index] = { ...pending, arguments: pending.arguments + delta.arguments };
          }
          break;
        }
        case "text_annotation_delta":
          if (nativeSearch) collectGeminiInteractionAnnotationSources(state.sources, delta.annotations);
          break;
        case "file_search_call":
          if (nativeSearch) state.fileSearchUsed = true;
          break;
        case "file_search_result":
          if (Array.isArray(delta.result)) {
            for (const result of delta.result) {
              collectGeminiInteractionFileSearchResult({ sources: state.sources, contexts: nativeSearch ? state.contexts : [] }, result);
            }
          }
          break;
        case "google_search_result":
          collectGeminiWebSources(delta, state.webSources);
          if (!state.webSearchUsed) {
            state.webSearchUsed = true;
            effects.push({ type: "web_search_used" });
          }
          break;
      }
      break;
    }
    case "step.stop": {
      const pending = index !== undefined ? state.pendingCalls[index] : undefined;
      if (index !== undefined && pending) {
        const accumulator = new GeminiFunctionCallAccumulator();
        accumulator.start(index, pending.call.id, pending.call.name, pending.call.args);
        accumulator.appendArguments(index, pending.arguments);
        const call = accumulator.finish(index);
        if (call) state.functionCalls.push(call);
        delete state.pendingCalls[index];
      }
      break;
    }
    case "interaction.status_update": {
      const metadata = record(event.metadata);
      // SDK generations expose either field. Prefer the v2 aggregate when both exist.
      const usage = metadata.total_usage ?? metadata.usage;
      if (usage != null) state.usage = usage;
      break;
    }
    case "interaction.completed": {
      const interaction = record(event.interaction);
      if (interaction.usage != null) state.usage = interaction.usage;
      if (nativeSearch) collectGeminiInteractionStepSources(state, interaction.steps);
      const error = getGeminiInteractionStatusError(interaction.status);
      if (error) effects.push({ type: "error", error });
      break;
    }
    case "error": {
      const message = record(event.error).message;
      effects.push({ type: "error", error: typeof message === "string" ? message : "Unknown interaction error" });
      break;
    }
  }
  return { state, effects };
}
