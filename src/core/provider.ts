import type {
  GeneratedImage,
  ProviderContinuation,
  RagContext,
  ToolCall,
  ToolResult,
  WebSearchCitation,
  WebSearchSource,
} from "./message.js";
import type { StreamChunkUsage } from "./usage.js";

// Re-exported here because the provider-facing types are what hosts import as a set.
export type { WebSearchCitation, WebSearchSource } from "./message.js";

/** A tool as declared to a provider. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ToolPropertyDefinition>;
    required?: string[];
  };
}

/**
 * A tool as declared to an OpenAI-compatible endpoint (Ollama, LM Studio, ...),
 * which nests the same schema under `function`.
 */
export interface OpenAiToolDefinition {
  type: "function";
  function: ToolDefinition;
}

/** Wrap a shared tool definition in the OpenAI wire shape. */
export function toOpenAiTool(tool: ToolDefinition): OpenAiToolDefinition {
  return { type: "function", function: tool };
}

export interface ToolPropertyDefinition {
  type: string;
  description?: string;
  enum?: string[];
  properties?: Record<string, ToolPropertyDefinition>;
  required?: string[];
  items?: ToolPropertyDefinition | {
    type: string;
    properties?: Record<string, ToolPropertyDefinition>;
    required?: string[];
  };
}

/**
 * One event from a streaming completion. Providers emit the subset they support; a host
 * that cannot produce a field simply never sets it.
 */
export interface StreamChunk {
  /**
   * `replace_text` overwrites the accumulated text with `content` instead of
   * appending to it: a provider that has to strip inline tool-call JSON back
   * out of what it already streamed says so this way.
   *
   * `incomplete_tool_call` reports that a tool call arrived truncated, so the
   * caller can retry the round rather than continue without it.
   */
  type: "text" | "thinking" | "tool_call" | "tool_result" | "error" | "done"
    | "rag_used" | "web_search_used" | "image_generated" | "session_id"
    | "replace_text" | "incomplete_tool_call";
  content?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  error?: string;
  /** Source files a RAG search matched. */
  ragSources?: string[];
  /** The excerpts a RAG search returned. */
  ragContexts?: RagContext[];
  generatedImage?: GeneratedImage;
  /** CLI session id, for resuming a conversation with a CLI provider. */
  sessionId?: string;
  /** Token usage and cost; set on "done" chunks. */
  usage?: StreamChunkUsage;
  /** Interactions API interaction id; set on "done" chunks. */
  interactionId?: string;
  /** Cited web sources, in display order. */
  webSearchSources?: WebSearchSource[];
  webSearchCitations?: WebSearchCitation[];
  /** Opaque native context, so a stateless provider can replay the turn. */
  providerContinuation?: ProviderContinuation;
}

/**
 * How much thinking a model should do. Providers accept different subsets — see each
 * provider's own options helper for what a given model actually offers.
 */
export type ReasoningEffort = "default" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
