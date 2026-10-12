import type { App } from "obsidian";
import type { ToolDefinition } from "../core/provider.js";
import { collectSkillScripts, collectSkillWorkflows, type LoadedSkill } from "../skills/skillsLoader.js";
import {
  READ_SKILL_TOOL,
  READ_SKILL_TOOL_NAME,
  SKILL_SCRIPT_TOOL_NAME,
  SKILL_WORKFLOW_TOOL_NAME,
  createSkillScriptTool,
  createSkillWorkflowTool,
  executeReadSkillTool,
} from "../skills/skillTools.js";
import { runSkillWorkflow } from "./skillWorkflow.js";

export interface SkillToolsetOptions {
  /** Folders the skill workflows may touch; undefined or empty means the whole vault. */
  vaultToolAllowedFolders: string[] | undefined;
  /** The host also resolves `[READ_SKILL]` markers (see SkillToolOptions). */
  readSkillMarker: boolean;
  /** Runs a skill script. Hosts that do not execute scripts leave it out, and the tool is not offered. */
  runScript?: (scriptId: string, argsJson: string | undefined) => Promise<Record<string, unknown>>;
}

export interface SkillToolset {
  tools: ToolDefinition[];
  /** Whether the name is one of this toolset's tools. */
  has(name: string): boolean;
  execute(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/**
 * The skill tools a tool-calling model gets for the active skills: read_skill
 * for vault skills whose SKILL.md is still lazy, run_skill_workflow when a
 * skill offers workflows, and run_skill_script when the host runs scripts.
 */
export function createSkillToolset(app: App, skills: LoadedSkill[], options: SkillToolsetOptions): SkillToolset {
  const workflows = collectSkillWorkflows(skills);
  const scripts = options.runScript ? collectSkillScripts(skills) : new Map();
  const tools: ToolDefinition[] = [
    ...(skills.some(skill => !skill.instructions) ? [READ_SKILL_TOOL] : []),
    ...(workflows.size > 0 ? [createSkillWorkflowTool({ readSkillMarker: options.readSkillMarker })] : []),
    ...(scripts.size > 0 ? [createSkillScriptTool({ readSkillMarker: options.readSkillMarker })] : []),
  ];
  const names = new Set(tools.map(tool => tool.name));
  return {
    tools,
    has: name => names.has(name),
    async execute(name, args) {
      if (!names.has(name)) return { error: `Unknown tool: ${name}` };
      if (name === READ_SKILL_TOOL_NAME) return executeReadSkillTool(app, skills, args.skillName as string);
      if (name === SKILL_WORKFLOW_TOOL_NAME) {
        return runSkillWorkflow(app, args.workflowId as string, args.variables as string | undefined, workflows,
          { vaultToolAllowedFolders: options.vaultToolAllowedFolders });
      }
      if (name === SKILL_SCRIPT_TOOL_NAME && options.runScript) return options.runScript(args.scriptId as string, args.args as string | undefined);
      return { error: `Unknown tool: ${name}` };
    },
  };
}
