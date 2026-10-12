import type { App } from "obsidian";
import type { Message } from "../core/message.js";
import { discoverSkills, loadSkill, type LoadedSkill } from "../skills/skillsLoader.js";
import type { DashboardSkillOption, DashboardTimelineAnswerOptions, DashboardTimelineAnswerRequest } from "./contract.js";

export interface TimelineAnswerPromptParts {
  /** Read-only Vault tools are offered. */
  vaultRead?: boolean;
  /** RAG results, or a note that a search store is attached; the host formats it. */
  ragContext?: string;
  /** MCP tools are offered. */
  mcp?: boolean;
  /** buildSkillSystemPrompt output for the active skills. */
  skillPrompt?: string;
  /** The Hub's own system prompt setting. */
  additionalInstructions?: string;
}

/** System prompt for an @ai answer in a Dashboard Hub Timeline thread. */
export function timelineAnswerSystemPrompt(parts: TimelineAnswerPromptParts): string {
  let prompt = "You are the AI participant in an Obsidian Timeline thread. Posts that mention @ai are addressed to you. Answer the user's latest question in the user's language as concise Markdown. Do not repeat or rewrite the question.";
  if (parts.vaultRead) prompt += "\nRead-only Vault tools are available. Use them when the answer depends on the user's notes.";
  if (parts.ragContext) prompt += parts.ragContext.startsWith("\n") ? parts.ragContext : `\n${parts.ragContext}`;
  if (parts.mcp) prompt += "\nMCP tools from the user's external services are available. Use them when the question needs those services.";
  if (parts.skillPrompt) prompt += parts.skillPrompt;
  if (parts.additionalInstructions) prompt += `\n\nAdditional instructions: ${parts.additionalInstructions}`;
  return prompt;
}

/** The thread as chat messages, ending on the question being answered. */
export function timelineAnswerMessages(request: Pick<DashboardTimelineAnswerRequest, "messages" | "question">, now = Date.now()): Message[] {
  const messages: Message[] = request.messages.map(message => ({ role: message.role, content: message.content, timestamp: now }));
  // A retried question may be followed by later posts.
  if (messages[messages.length - 1]?.content !== request.question) {
    messages.push({ role: "user", content: `Answer this post from the thread:\n\n${request.question}`, timestamp: now });
  }
  return messages;
}

/** Reject lookups the model cannot do, before any request is sent. */
export function assertTimelineAnswerSupported(request: DashboardTimelineAnswerRequest, options: Pick<DashboardTimelineAnswerOptions, "webSearch">): void {
  if (request.webSearch && request.ragSetting) throw new Error("RAG and Web Search cannot be used at the same time.");
  if (request.webSearch && !options.webSearch) throw new Error("Web Search is not available for this model.");
}

/** Every skill the Hub knows: built-in, runtime, agent plugin, and vault skills. */
export async function listDashboardSkills(app: App, skillsFolder?: string): Promise<DashboardSkillOption[]> {
  return (await discoverSkills(app, skillsFolder || undefined)).map(skill => ({ id: skill.folderPath, name: skill.name }));
}

/** The selected skills, loaded the way Chat loads them: vault skills stay lazy and are read on demand. */
export async function loadDashboardSkills(app: App, skillsFolder: string | undefined, ids: string[] | undefined): Promise<LoadedSkill[]> {
  if (!ids?.length) return [];
  return (await discoverSkills(app, skillsFolder || undefined))
    .filter(skill => ids.includes(skill.folderPath))
    .map(skill => loadSkill(app, skill));
}
