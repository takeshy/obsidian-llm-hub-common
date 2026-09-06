import type { StreamChunkUsage } from "./usage.js";
import type { McpServerConfig } from "./mcpTypes.js";

/**
 * The chat message shape, wide enough for every plugin: each uses the subset its provider fills in.
 * Only role, content and timestamp are always present.
 */

export interface Message {
  role: "user" | "assistant" | "tool";
  content: string;
  llmContent?: string;          // full content sent to the LLM (hidden from UI)
  timestamp: number;
  model?: string;  // Model name (assistant messages only)
  modelDisplayName?: string; // Exact runtime model configuration shown in chat/history
  toolsUsed?: string[];  // 使用したツール名の配列
  attachments?: Attachment[];  // 添付ファイル
  pendingEdit?: PendingEditInfo;  // 保留中の編集情報
  pendingEdits?: PendingEditInfo[];  // 複数の編集結果
  pendingDelete?: PendingDeleteInfo;  // 保留中の削除情報
  pendingDeletes?: PendingDeleteInfo[];  // 複数の削除結果
  pendingRename?: PendingRenameInfo;  // 保留中のリネーム情報
  pendingRenames?: PendingRenameInfo[];  // 複数のリネーム結果
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  ragUsed?: boolean;  // RAG（File Search）が使用されたか
  ragSources?: string[];  // RAG検索で見つかったソースファイル
  webSearchUsed?: boolean;  // Web Searchが使用されたか
  webSearchSources?: WebSearchSource[];  // Cited web sources in display order
  providerContinuation?: ProviderContinuation;  // Opaque native context for stateless replay
  imageGenerationUsed?: boolean;  // Image Generationが使用されたか
  generatedImages?: GeneratedImage[];  // 生成された画像
  thinking?: string;  // モデルの思考内容（thinkingモデル用）
  skillsUsed?: string[];  // Names of active skills used
  mcpApps?: McpAppInfo[];  // MCP Apps with UI (MCP Apps拡張)
  usage?: StreamChunkUsage;  // Token usage and cost
  elapsedMs?: number;        // Response time in milliseconds
  interactionId?: string;    // Interactions API interaction ID for conversation chaining
  ragContexts?: RagContext[];   // Excerpts retrieved by RAG search
  ragCitations?: RagCitation[];   // per-chunk citation locations (new chats)
  toolCallId?: string;          // tool call ID (for tool role messages, LM Studio)
  toolName?: string;            // tool name (for tool role messages, Ollama)
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  result: unknown;
}

export interface Attachment {
  name: string;
  type: "image" | "pdf" | "text" | "audio" | "video";
  mimeType: string;
  data: string;  // Base64エンコードされたデータ
  sourcePath?: string;  // RAG検索結果のソースファイルパス
  pageLabel?: string;  // PDFページ範囲（例: "pages 1-6 of 24"）
}

export interface PendingEditInfo {
  originalPath: string;
  status: "pending" | "applied" | "discarded" | "failed";
}

export interface PendingDeleteInfo {
  path: string;
  status: "pending" | "deleted" | "cancelled" | "failed";
}

export interface PendingRenameInfo {
  originalPath: string;
  newPath: string;
  status: "pending" | "applied" | "discarded" | "failed";
}

export interface WebSearchSource {
  title: string;
  url: string;
}

export interface GeneratedImage {
  mimeType: string;
  data: string;  // Base64 encoded image data
}

export interface RagCitation {
  filePath: string;
  heading?: string;      // nearest Markdown heading ("" when none)
  startOffset: number;   // chunk start offset in the source document
  snippet?: string;      // optional preview; NOT populated for persisted citations
  pageLabel?: string;    // PDF page range, e.g. "pages 2-5 of 24"
}

export interface ProviderContinuation {
  provider: "openai" | "anthropic" | "xai";
  baseUrl: string;
  model: string;
  items: unknown[];
  /** Responses API response ID used for provider-native multi-turn chaining. */
  responseId?: string;
}

export interface McpAppResult {
  content: McpAppContent[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  _meta?: {
    ui?: {
      resourceUri: string;
    };
    "ui/resourceUri"?: string;
  };
}

export interface McpAppUiResource {
  uri: string;
  mimeType: string;
  text?: string;
  blob?: string;  // Base64 encoded binary data
  _meta?: {
    ui?: {
      csp?: {
        connectDomains?: string[];
        resourceDomains?: string[];
        resource_domains?: string[];
        frameDomains?: string[];
        frame_domains?: string[];
        baseUriDomains?: string[];
        base_uri_domains?: string[];
        connect_domains?: string[];
      };
    };
  };
}

export interface McpAppContent {
  type: "text" | "image" | "resource";
  text?: string;
  data?: string;
  mimeType?: string;
  resource?: {
    uri: string;
    mimeType?: string;
    text?: string;
  };
}

export interface McpAppInfo {
  serverUrl: string;
  serverHeaders?: Record<string, string>;
  serverConfig?: McpServerConfig;  // Full config for client recreation (supports stdio)
  toolResult: McpAppResult;
  uiResource?: McpAppUiResource | null;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  _meta?: {
    ui?: {
      resourceUri: string;  // ui:// URI for MCP Apps
    };
    "ui/resourceUri"?: string;
  };
}

export interface RagContext {
  source: string;
  text: string;
}
