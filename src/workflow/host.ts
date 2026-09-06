import type { StreamChunkUsage } from "../core/usage.js";
import type { App } from "obsidian";
import type { EncryptionConfig } from "./history.js";
import type { ExecutionContext, PromptCallbacks, WorkflowNode } from "./types.js";
import type { WorkflowEventTrigger } from "./triggers.js";

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

/** What a node handler needs from the executor to do its work. */
export interface NodeRequest {
  node: WorkflowNode;
  context: ExecutionContext;
  app: App;
  callbacks?: PromptCallbacks;
  abortSignal?: AbortSignal;
}

export interface CommandNodeRequest extends NodeRequest {
  traceId: string | null;
}

export interface CommandNodeResult {
  usedModel?: string;
  mcpAppInfo?: unknown;
  usage?: StreamChunkUsage;
  elapsedMs?: number;
}

/** Optional tracing hooks; hosts without an observability backend leave this out. */
export interface WorkflowTracing {
  traceStart(name: string, payload?: Record<string, unknown>): string | null;
  spanStart(traceId: string | null, name: string, payload?: Record<string, unknown>): string | null;
  spanEnd(spanId: string | null, payload?: Record<string, unknown>): void;
  traceEnd(traceId: string | null, payload?: Record<string, unknown>): void;
  score(traceId: string | null, params: { name: string; value: number; comment?: string }): void;
}

/** A no-op used when the host has no tracing, so shared code can call it unconditionally. */
export const noTracing: WorkflowTracing = {
  traceStart: () => null,
  spanStart: () => null,
  spanEnd: () => {},
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
  /** Workflow files the user bound to a hotkey, and the setter the panel saves through. */
  getWorkflowHotkeys(): string[];
  setWorkflowHotkeys(paths: string[]): void;
  /** Workflows started by Obsidian events, and the setter the panel saves through. */
  getWorkflowEventTriggers(): WorkflowEventTrigger[];
  setWorkflowEventTriggers(triggers: WorkflowEventTrigger[]): void;
  /** Runs a workflow the way its hotkey would, for the panel's run button. */
  runWorkflowFromHotkey(path: string): void;
  /** The workflow the selector opened last, so it can reopen there. */
  getLastSelectedWorkflow(): string | undefined;
  setLastSelectedWorkflow(path: string): void;
  /** Runs a prompt against the host's model layer — the one thing this package cannot do itself. */
  streamChat(request: WorkflowChatRequest): AsyncIterable<WorkflowChatChunk>;
  /** Observability, for hosts that have it wired up. */
  tracing?: WorkflowTracing;
  /** Runs a command node: the model call with the host's tools, RAG and MCP wiring. */
  runCommandNode(request: CommandNodeRequest): Promise<CommandNodeResult>;
  /** Runs an MCP tool node, for hosts with MCP support. */
  runMcpNode?(request: NodeRequest): Promise<unknown>;
  /** Runs a shell node, for hosts that allow shell commands. */
  runShellNode?(request: NodeRequest): Promise<void>;
  /** Runs a RAG index sync node, for hosts with a local index. */
  runRagSyncNode?(request: NodeRequest): Promise<void>;
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
  getWorkflowHotkeys: () => [],
  setWorkflowHotkeys: () => {},
  getWorkflowEventTriggers: () => [],
  setWorkflowEventTriggers: () => {},
  runWorkflowFromHotkey: () => {},
  getLastSelectedWorkflow: () => undefined,
  setLastSelectedWorkflow: () => {},
  // eslint-disable-next-line require-yield
  streamChat: async function* () {
    throw new Error("No workflow host is configured: call configureWorkflowHost() during plugin load.");
  },
  runCommandNode: () => {
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
