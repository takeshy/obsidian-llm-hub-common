import { parseDecisionDefinition, parseDecisionQuestions, type DecisionQuestions, type DecisionDefinition } from "../core/decision.js";
import type { ExecutionContext, SidebarNode, WorkflowNode } from "./types.js";
import { replaceVariables } from "./handlers/utils.js";

export function isBatchDecision(node: Pick<WorkflowNode, "type" | "properties">): boolean {
  return node.type === "decision" && node.properties.decisionType === "batch";
}

export function getDecisionNodeQuestions(node: Pick<WorkflowNode, "properties">, context: ExecutionContext): DecisionQuestions {
  let questions: unknown;
  try { questions = JSON.parse(replaceVariables(node.properties.questions || "", context)); }
  catch { throw new Error("Decision questions must be valid JSON after variable expansion"); }
  return parseDecisionQuestions(questions);
}

export function isChoiceDecision(node: Pick<WorkflowNode, "type" | "properties">): boolean {
  return node.type === "decision" && node.properties.decisionType === "choice";
}

export function parseDecisionBranches(value: string): Record<string, string> {
  let branches: unknown;
  try { branches = JSON.parse(value); } catch { throw new Error("Choice branches must be a JSON object mapping choices to node IDs"); }
  if (!branches || typeof branches !== "object" || Array.isArray(branches)
    || !Object.entries(branches).every(([key, target]) => key.trim() && typeof target === "string" && target.trim())) {
    throw new Error("Choice branches must map choice names to nonempty node IDs");
  }
  return Object.fromEntries(Object.entries(branches)) as Record<string, string>;
}

/** Partial choices remain editable even before valid route JSON has been entered. */
export function choiceBranchEntries(node: Pick<SidebarNode, "type" | "properties">): [string, string][] {
  if (!isChoiceDecision(node)) return [];
  try { return Object.entries(parseDecisionBranches(node.properties.branches || "")); } catch { return []; }
}

export function getDecisionNodeDefinition(node: Pick<WorkflowNode, "properties">, context: ExecutionContext): DecisionDefinition {
  const type = node.properties.decisionType || "boolean";
  let criteria: unknown;
  if (type !== "boolean" && node.properties.criteria) {
    try { criteria = JSON.parse(replaceVariables(node.properties.criteria, context)); }
    catch { throw new Error("Decision criteria must be valid JSON after variable expansion"); }
  }
  return parseDecisionDefinition(type, criteria);
}

export function decisionThreshold(node: Pick<WorkflowNode, "properties">, context: ExecutionContext, maximum: number): number {
  const raw = replaceVariables(node.properties.threshold || "", context).trim();
  const threshold = raw ? Number(raw) : maximum / 2;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > maximum) {
    throw new Error(`Score threshold must be between 0 and ${maximum}`);
  }
  return threshold;
}

export function validateChoiceBranches(branches: Record<string, string>, criteria: Record<string, string>): void {
  if (Object.keys(branches).length !== Object.keys(criteria).length
    || Object.keys(criteria).some(key => !Object.prototype.hasOwnProperty.call(branches, key))) {
    throw new Error("Choice branches must have exactly one target for every choice criterion");
  }
}
