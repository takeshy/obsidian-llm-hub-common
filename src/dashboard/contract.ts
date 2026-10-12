/**
 * Dashboard Hub AI integration protocol v1, as the Hubs implement it.
 * Dashboard Hub keeps its own copy; keep the two field-compatible. New fields
 * stay optional so older Hubs and older Dashboard Hubs keep working.
 */
export interface DashboardAiModel {
  id: string;
  name: string;
  capabilities: { text: boolean; vaultRead: boolean; tools: boolean };
}

export interface DashboardWorkflowRequest {
  workflowPath: string;
  outputVariable?: string;
  abortSignal?: AbortSignal;
}

export interface DashboardBaseRequest {
  modelId: string;
  instruction: string;
  currentYaml?: string;
  basePath?: string;
  allowVaultRead: boolean;
  previousResult?: string;
  abortSignal?: AbortSignal;
}

export interface DashboardRewriteRequest {
  modelId: string;
  content: string;
  instruction: string;
  previousResult?: string;
  context: "timeline" | "memo";
  abortSignal?: AbortSignal;
}

export interface DashboardWorkflowGenerationRequest {
  modelId: string;
  mode: "create" | "modify";
  instruction: string;
  currentMarkdown?: string;
  previousResult?: string;
  outputContract: { outputVariable: string; format: "markdown" | "html" };
  allowVaultRead: boolean;
  abortSignal?: AbortSignal;
}

export interface DashboardTimelineAnswerRequest {
  modelId: string;
  messages: { role: "user" | "assistant"; content: string }[];
  question: string;
  allowVaultRead?: boolean;
  /** Never combined with ragSetting. */
  webSearch?: boolean;
  ragSetting?: string;
  /** MCP server names. */
  mcpServers?: string[];
  /** Skill ids (skill folder paths). */
  skills?: string[];
  abortSignal?: AbortSignal;
}

export interface DashboardSkillOption {
  id: string;
  name: string;
}

/** What answerTimeline can use with one model. */
export interface DashboardTimelineAnswerOptions {
  vaultRead: boolean;
  webSearch: boolean;
  ragSettings: string[];
  mcpServers: string[];
  skills: DashboardSkillOption[];
}
