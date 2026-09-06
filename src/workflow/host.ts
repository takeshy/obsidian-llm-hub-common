import type { StreamChunkUsage } from "../core/usage.js";
import type { EncryptionConfig } from "./history.js";

/**
 * What shared workflow code needs from the plugin around it. Everything here is host-specific by
 * nature — which models exist, which indexes and MCP servers are configured — so a host registers
 * an implementation at load and shared UI reads it instead of reaching for a plugin type.
 */
export interface WorkflowModelOption {
  value: string;
  label: string;
}

/** An attachment the user added to a generation prompt. `data` is base64 for binary types. */
export interface WorkflowAttachment {
  type: string;
  name: string;
  mimeType?: string;
  data?: string;
  text?: string;
}

/** Optional tracing hooks; hosts without an observability backend leave this out. */
export interface WorkflowTracing {
  traceStart(name: string, payload?: Record<string, unknown>): string | null;
  traceEnd(traceId: string | null, payload?: Record<string, unknown>): void;
  score(traceId: string | null, params: { name: string; value: number; comment?: string }): void;
}

/** A no-op used when the host has no tracing, so shared code can call it unconditionally. */
export const noTracing: WorkflowTracing = {
  traceStart: () => null,
  traceEnd: () => {},
  score: () => {},
};

/** One piece of a streamed model response. */
export interface WorkflowChatChunk {
  type: "text" | "thinking" | "done" | "error";
  content?: string;
  usage?: StreamChunkUsage;
  error?: string;
}

export interface WorkflowChatRequest {
  /** Empty or omitted means "whatever model the host is currently using". */
  model?: string;
  systemPrompt: string;
  userPrompt: string;
  /** Host-shaped attachment payloads, passed through untouched. */
  attachments?: WorkflowAttachment[];
  abortSignal?: AbortSignal;
  traceId?: string | null;
}

export interface WorkflowHost {
  /** Models offered for a command node, in the order the host wants them shown. */
  getModelOptions(): WorkflowModelOption[];
  /** Names of the configured RAG indexes, empty when the host has none. */
  getRagSettingNames(): string[];
  /** Names of the configured MCP servers, empty when the host has no MCP support. */
  getMcpServerNames(): string[];
  /** The model the host is chatting with right now, used when a node picks no model of its own. */
  getCurrentModel(): string;
  /** The model last used for AI workflow generation, remembered between sessions. */
  getLastWorkflowModel(): string | undefined;
  setLastWorkflowModel(model: string): void;
  /** The workflow specification to hand the model, tailored to what this host can run. */
  getWorkflowSpecification(): string;
  /** Vault folders this host keeps its workspace and skills in. */
  getWorkspaceFolder(): string;
  getSkillsFolder(): string;
  /** Encryption for stored execution history, when the host has it configured. */
  getHistoryEncryption(): EncryptionConfig | undefined;
  /** The plugin version, recorded with generated workflows. */
  getPluginVersion(): string;
  /** Runs a prompt against the host's model layer — the one thing this package cannot do itself. */
  streamChat(request: WorkflowChatRequest): AsyncIterable<WorkflowChatChunk>;
  /** Observability, for hosts that have it wired up. */
  tracing?: WorkflowTracing;
}

const noHost: WorkflowHost = {
  getModelOptions: () => [],
  getRagSettingNames: () => [],
  getMcpServerNames: () => [],
  getCurrentModel: () => "",
  getLastWorkflowModel: () => undefined,
  setLastWorkflowModel: () => {},
  getWorkflowSpecification: () => "",
  getWorkspaceFolder: () => "",
  getSkillsFolder: () => "",
  getHistoryEncryption: () => undefined,
  getPluginVersion: () => "",
  // eslint-disable-next-line require-yield
  streamChat: async function* () {
    throw new Error("No workflow host is configured: call configureWorkflowHost() during plugin load.");
  },
};

let host: WorkflowHost = noHost;

export function configureWorkflowHost(next: WorkflowHost): void {
  host = next;
}

export function workflowHost(): WorkflowHost {
  return host;
}

export function workflowTracing(): WorkflowTracing {
  return host.tracing ?? noTracing;
}
