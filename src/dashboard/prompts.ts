import type { LoadedSkill } from "../skills/skillsLoader.js";
import type { DashboardBaseRequest, DashboardRewriteRequest, DashboardWorkflowGenerationRequest } from "./contract.js";

/** A one-shot generation: the user prompt and the system prompt that frames it. */
export interface DashboardPrompt {
  prompt: string;
  systemPrompt: string;
}

/** Remove the code fence a model wraps YAML in despite being told not to. */
export function stripYamlFence(text: string): string {
  return text.replace(/^\s*```(?:ya?ml)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
}

/** Base authoring. `basesSkill` is the host's built-in Bases skill, inlined as reference. */
export function dashboardBasePrompt(request: DashboardBaseRequest, basesSkill: LoadedSkill | null): DashboardPrompt {
  const source = request.previousResult || request.currentYaml;
  const reference = basesSkill ? `${basesSkill.instructions}\n\n${basesSkill.references.join("\n\n")}` : "";
  return {
    prompt: source
      ? `Revise this Base according to the instruction.\nInstruction: ${request.instruction}\n\nCurrent YAML:\n${source}`
      : `Create an Obsidian Base.\nInstruction: ${request.instruction}`,
    systemPrompt: `You author valid Obsidian Bases .base YAML. Return only YAML without fences. Use read-only Vault tools when available to verify real property names.\n\n${reference}`,
  };
}

export function dashboardRewritePrompt(request: DashboardRewriteRequest): DashboardPrompt {
  return {
    prompt: `Instruction: ${request.instruction}\n\nText to rewrite:\n${request.previousResult || request.content}`,
    systemPrompt: `Rewrite the ${request.context} text. Return only the rewritten text without explanation or fences.`,
  };
}

/** Workflow authoring. `workflowSpecification` is the host's workflow spec, which lists its own node types. */
export function dashboardWorkflowPrompt(request: DashboardWorkflowGenerationRequest, workflowSpecification: string): DashboardPrompt {
  const source = request.previousResult || request.currentMarkdown;
  return {
    prompt: `${request.mode === "modify" ? "Revise" : "Create"} an unattended Obsidian Workflow.\nInstruction: ${request.instruction}\nOutput must be ${request.outputContract.format} in variable ${request.outputContract.outputVariable}.${source ? `\n\nCurrent workflow:\n${source}` : ""}`,
    systemPrompt: `Return only a complete Markdown workflow document with a workflow YAML code block. Do not use interactive nodes.\n\n${workflowSpecification}`,
  };
}
