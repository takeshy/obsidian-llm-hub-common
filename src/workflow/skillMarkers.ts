import type { App } from "obsidian";
import type { LoadedSkill } from "../skills/skillsLoader.js";
import { collectSkillWorkflows, readSkillBody } from "../skills/skillsLoader.js";
import { runSkillWorkflow } from "./skillWorkflow.js";

/**
 * Maximum number of marker-driven agent iterations for CLI / Local-LLM paths.
 * Protects against infinite loops where the model keeps emitting markers.
 */
export const MAX_MARKER_AGENT_ITERATIONS = 5;

export interface SkillMarkerOptions {
  signal?: AbortSignal;
  /** Folders the skill workflows may touch; undefined or empty means the whole vault. */
  vaultToolAllowedFolders?: string[];
  /**
   * Runs one `[RUN_SCRIPT]` marker. Only hosts that execute skill scripts pass it;
   * without it the markers are left in place, as the model was never offered them.
   */
  runScript?: (scriptId: string, argsJson: string | undefined) => Promise<Record<string, unknown>>;
}

export interface SkillMarkerResult {
  /** The response with markers replaced by result blocks, for display. */
  processedContent: string;
  /** Results to feed back to the model; undefined when no marker ran, which ends the agent loop. */
  followUpMessage?: string;
  aborted?: boolean;
}

function matchesOf(regex: RegExp, content: string): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) matches.push(match);
  return matches;
}

/**
 * Detect `[READ_SKILL]` / `[RUN_WORKFLOW]` / `[RUN_SCRIPT]` markers in an LLM
 * response (the skill route for CLI and Local-LLM models that have no tool
 * calling), execute each, and return the display text and the follow-up message.
 */
export async function processSkillMarkers(
  app: App,
  content: string,
  skills: LoadedSkill[],
  options: SkillMarkerOptions = {},
): Promise<SkillMarkerResult> {
  if (skills.length === 0) return { processedContent: content };
  const { signal } = options;

  let processedContent = content;
  const resultSections: string[] = [];

  for (const match of matchesOf(/\[READ_SKILL:\s*(.+?)\]/g, content)) {
    if (signal?.aborted) return { processedContent, aborted: true };
    const skillName = match[1].trim();
    const skill = skills.find(s => s.name === skillName);
    if (!skill) {
      const errMsg = `Unknown skill: ${skillName}. Available: ${skills.map(s => s.name).join(", ")}`;
      processedContent = processedContent.replace(match[0], `**Skill read failed: ${skillName}** — ${errMsg}`);
      resultSections.push(`Skill "${skillName}" read error:\n${errMsg}`);
      continue;
    }
    const loaded = await readSkillBody(app, skill);
    const body = loaded.instructions
      + (loaded.references.length > 0 ? `\n\n### References\n\n${loaded.references.join("\n\n")}` : "");
    processedContent = processedContent.replace(match[0], `**Skill loaded: ${skillName}**`);
    resultSections.push(`Skill "${skillName}" SKILL.md:\n${body}`);
  }

  const skillWorkflowMap = collectSkillWorkflows(skills);
  for (const match of matchesOf(/\[RUN_WORKFLOW:\s*(.+?)\](?:\((\{[\s\S]*?\})\))?/g, content)) {
    if (signal?.aborted) return { processedContent, aborted: true };
    const workflowId = match[1].trim();
    const result = await runSkillWorkflow(app, workflowId, match[2] || undefined, skillWorkflowMap,
      { vaultToolAllowedFolders: options.vaultToolAllowedFolders });
    const resultText = JSON.stringify(result, null, 2);
    processedContent = processedContent.replace(match[0], `**Workflow executed: ${workflowId}**\n\`\`\`json\n${resultText}\n\`\`\``);
    resultSections.push(`Workflow "${workflowId}" result:\n\`\`\`json\n${resultText}\n\`\`\``);
  }

  if (options.runScript) {
    for (const match of matchesOf(/\[RUN_SCRIPT:\s*(.+?)\](?:\(([\s\S]*?)\))?/g, content)) {
      if (signal?.aborted) return { processedContent, aborted: true };
      const scriptId = match[1].trim();
      const result = await options.runScript(scriptId, match[2] || undefined);
      const resultText = JSON.stringify(result, null, 2);
      processedContent = processedContent.replace(match[0], `**Script executed: ${scriptId}**\n\`\`\`json\n${resultText}\n\`\`\``);
      resultSections.push(`Script "${scriptId}" result:\n\`\`\`json\n${resultText}\n\`\`\``);
    }
  }

  if (resultSections.length === 0) return { processedContent };

  const followUpMessage = `Tool execution results:\n\n${resultSections.join("\n\n")}\n\nPlease continue based on these results. You may call more tools if needed, or give the user your final answer.`;
  return { processedContent, followUpMessage };
}
