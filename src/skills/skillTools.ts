import type { App } from "obsidian";
import type { ToolDefinition } from "../core/provider.js";
import type { SkillMetadata } from "./skillsLoader.js";
import { readSkillBody } from "./skillsLoader.js";

export const READ_SKILL_TOOL_NAME = "read_skill";
export const SKILL_WORKFLOW_TOOL_NAME = "run_skill_workflow";
export const SKILL_SCRIPT_TOOL_NAME = "run_skill_script";

/**
 * What the host can do besides tool calls, which changes how the model is told
 * to reach a vault skill's SKILL.md. Required rather than optional: a host that
 * gains or loses the marker handler has to say so, so the two descriptions
 * cannot drift apart again.
 */
export interface SkillToolOptions {
  /**
   * Host resolves a `[READ_SKILL: skillName]` marker in the assistant's text
   * and feeds SKILL.md back as a follow-up message. Hosts without that handler
   * leave the model with the dedicated `read_skill` tool alone.
   */
  readSkillMarker: boolean;
}

function skillMdHint(options: SkillToolOptions): string {
  return options.readSkillMarker ? "`read_skill` or `[READ_SKILL: ...]`" : "`read_skill`";
}

/** Read only the SKILL.md body and references of a skill active in this chat. */
export const READ_SKILL_TOOL: ToolDefinition = {
  name: READ_SKILL_TOOL_NAME,
  description: "Read the full instructions and references for an active skill. This is limited to skills selected in the current chat and does not provide general Vault access.",
  parameters: {
    type: "object",
    properties: {
      skillName: {
        type: "string",
        description: "Name of an active skill, exactly as shown in the system prompt",
      },
    },
    required: ["skillName"],
  },
};

export async function executeReadSkillTool(
  app: App,
  activeSkills: readonly SkillMetadata[],
  skillName: string,
): Promise<Record<string, unknown>> {
  const skill = activeSkills.find(candidate => candidate.name === skillName);
  if (!skill) return { error: `Skill is not active: ${skillName}` };
  const loaded = await readSkillBody(app, skill);
  if (!loaded.instructions) return { error: `SKILL.md could not be read for active skill: ${skillName}` };
  return {
    name: loaded.name,
    instructions: loaded.instructions,
    references: loaded.references,
  };
}

/**
 * Tool definition for running a workflow declared by an active agent skill.
 * Added dynamically, only while a skill with workflows is active.
 */
export function createSkillWorkflowTool(options: SkillToolOptions): ToolDefinition {
  return {
    name: SKILL_WORKFLOW_TOOL_NAME,
    description:
      "Run a workflow provided by an active agent skill. Workflows can execute commands, HTTP requests, file operations, and more. "
      + `For vault skills the workflow ID and its input variables are defined inside SKILL.md — you must read SKILL.md (via ${skillMdHint(options)}) before you can construct a correct call. `
      + "If the workflow fails, do NOT retry automatically — report the error to the user instead.",
    parameters: {
      type: "object",
      properties: {
        workflowId: {
          type: "string",
          description: "The workflow ID to run (format: skillName/workflowName, discovered from the skill's SKILL.md)",
        },
        variables: {
          type: "string",
          description: "JSON object of input variables to pass to the workflow (e.g. {\"filePath\": \"notes/todo.md\"})",
        },
      },
      required: ["workflowId"],
    },
  };
}

/**
 * Tool definition for running a script declared by an active agent skill.
 * Scripts shell out, so only desktop hosts that execute them declare this.
 */
export function createSkillScriptTool(options: SkillToolOptions): ToolDefinition {
  return {
    name: SKILL_SCRIPT_TOOL_NAME,
    description:
      "Run a script provided by an active agent skill. Scripts execute shell commands on the local system (desktop only). "
      + `For vault skills the script ID is defined inside SKILL.md — you must read SKILL.md (via ${skillMdHint(options)}) to discover it.`,
    parameters: {
      type: "object",
      properties: {
        scriptId: {
          type: "string",
          description: "The script ID to run (format: skillName/scriptName, discovered from the skill's SKILL.md)",
        },
        args: {
          type: "string",
          description: "JSON array of string arguments to pass to the script (e.g. [\"./dir\", \"--flag\"])",
        },
      },
      required: ["scriptId"],
    },
  };
}
