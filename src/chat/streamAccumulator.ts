import type {
  GeneratedImage,
  Message,
  PendingDeleteInfo,
  PendingEditInfo,
  PendingRenameInfo,
  RagContext,
  ToolCall,
  ToolResult,
  ProviderContinuation,
  WebSearchCitation,
  WebSearchSource,
} from "../core/message.js";
import type { StreamChunk } from "../core/provider.js";
import type { StreamChunkUsage } from "../core/usage.js";

/** Everything a stream says, gathered as it arrives. */
export interface StreamAccumulation {
  text: string;
  thinking: string;
  /** Tool names in the order first called, without repeats. */
  toolsUsed: string[];
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  ragUsed: boolean;
  ragSources: string[];
  ragContexts: RagContext[];
  webSearchUsed: boolean;
  webSearchSources: WebSearchSource[];
  /** Offsets a provider reports instead of linking the sources itself. */
  webSearchCitations: WebSearchCitation[];
  imageGenerationUsed: boolean;
  generatedImages: GeneratedImage[];
  /** A tool call arrived truncated; the round is worth retrying. */
  incompleteToolCall: boolean;
  usage?: StreamChunkUsage;
  interactionId?: string;
  sessionId?: string;
  /** What a provider needs to continue this exchange on the next turn. */
  providerContinuation?: ProviderContinuation;
}

export function createStreamAccumulation(): StreamAccumulation {
  return {
    text: "",
    thinking: "",
    toolsUsed: [],
    toolCalls: [],
    toolResults: [],
    ragUsed: false,
    ragSources: [],
    ragContexts: [],
    webSearchUsed: false,
    webSearchSources: [],
    webSearchCitations: [],
    imageGenerationUsed: false,
    generatedImages: [],
    incompleteToolCall: false,
  };
}

/**
 * Fold one chunk into what the stream has said so far.
 *
 * An "error" chunk throws: a provider reports a failed generation that way, and
 * the caller's catch is where a failed turn is already handled.
 */
export function accumulateStreamChunk(into: StreamAccumulation, chunk: StreamChunk): void {
  switch (chunk.type) {
    case "text":
      into.text += chunk.content || "";
      break;
    case "replace_text":
      // Not an append: the provider is correcting what it already streamed.
      into.text = chunk.content || "";
      break;
    case "thinking":
      into.thinking += chunk.content || "";
      break;
    case "tool_call":
      if (chunk.toolCall) {
        into.toolCalls.push(chunk.toolCall);
        if (!into.toolsUsed.includes(chunk.toolCall.name)) into.toolsUsed.push(chunk.toolCall.name);
      }
      break;
    case "incomplete_tool_call":
      into.incompleteToolCall = true;
      break;
    case "tool_result":
      if (chunk.toolResult) into.toolResults.push(chunk.toolResult);
      break;
    case "rag_used":
      into.ragUsed = true;
      // A retrieval can be reported in several chunks (one per index searched),
      // so the sources accumulate; replacing them keeps only the last index.
      for (const source of chunk.ragSources ?? []) {
        if (!into.ragSources.includes(source)) into.ragSources.push(source);
      }
      for (const context of chunk.ragContexts ?? []) {
        if (!into.ragContexts.some(c => c.source === context.source && c.text === context.text)) {
          into.ragContexts.push(context);
        }
      }
      break;
    case "web_search_used":
      into.webSearchUsed = true;
      break;
    case "image_generated":
      into.imageGenerationUsed = true;
      if (chunk.generatedImage) into.generatedImages.push(chunk.generatedImage);
      break;
    case "session_id":
      if (chunk.sessionId) into.sessionId = chunk.sessionId;
      break;
    case "error":
      throw new Error(chunk.error || "Unknown error");
    case "done":
      // The totals only exist once the stream has finished.
      if (chunk.usage) into.usage = chunk.usage;
      if (chunk.interactionId) into.interactionId = chunk.interactionId;
      if (chunk.webSearchSources) into.webSearchSources = chunk.webSearchSources;
      if (chunk.webSearchCitations) into.webSearchCitations = chunk.webSearchCitations;
      if (chunk.providerContinuation) into.providerContinuation = chunk.providerContinuation;
      break;
  }
}

/** What the confirming tool executor did during a turn. */
export interface ProcessedMutations {
  edits: PendingEditInfo[];
  deletes: PendingDeleteInfo[];
  renames: PendingRenameInfo[];
}

type PendingFields = Pick<
  Message,
  "pendingEdit" | "pendingEdits" | "pendingDelete" | "pendingDeletes" | "pendingRename" | "pendingRenames"
>;

/**
 * The vault changes a finished message reports.
 *
 * The singular field is the last change and the plural is all of them; the
 * bubble shows the plural when it is there and falls back to the singular. One
 * function sets both, because setting only the singular silently reduces a turn
 * that changed five files to one badge.
 */
export function pendingStatusFields({ edits, deletes, renames }: ProcessedMutations): PendingFields {
  return {
    pendingEdit: edits.at(-1),
    pendingEdits: edits.length > 0 ? edits : undefined,
    pendingDelete: deletes.at(-1),
    pendingDeletes: deletes.length > 0 ? deletes : undefined,
    pendingRename: renames.at(-1),
    pendingRenames: renames.length > 0 ? renames : undefined,
  };
}
