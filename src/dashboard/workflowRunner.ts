import { TFile, type App } from "obsidian";
import { WorkflowExecutor } from "../workflow/executor.js";
import { parseWorkflowFromMarkdown } from "../workflow/parser.js";
import type { PromptCallbacks, WorkflowInput } from "../workflow/types.js";
import type { DashboardWorkflowRequest } from "./contract.js";

/** Dashboard widgets run workflows unattended: every prompt is declined. */
function headlessCallbacks(): PromptCallbacks {
  return {
    promptForFile: () => Promise.resolve(null),
    promptForAnyFile: () => Promise.resolve(null),
    promptForNewFilePath: () => Promise.resolve(null),
    promptForSelection: () => Promise.resolve(null),
    promptForValue: () => Promise.resolve(null),
    promptForConfirmation: () => Promise.resolve({ action: "cancel" as const }),
    promptForDialog: () => Promise.resolve(null),
    promptForPassword: () => Promise.resolve(null),
  };
}

/** The named variable, else `result`, else the first non-internal string variable. */
export function extractWorkflowOutput(values: Map<string, string | number>, name?: string): string | null {
  const str = (value: unknown) => typeof value === "string" ? value : typeof value === "number" ? String(value) : null;
  if (name) return str(values.get(name));
  const result = str(values.get("result"));
  if (result != null) return result;
  for (const [key, value] of values) {
    const text = str(value);
    if (!key.startsWith("_") && text) return text;
  }
  return null;
}

/** Run a workflow for a Dashboard widget and return its text output. */
export async function runDashboardWorkflow(app: App, request: DashboardWorkflowRequest): Promise<string> {
  const file = app.vault.getAbstractFileByPath(request.workflowPath);
  if (!(file instanceof TFile)) throw new Error(`Workflow not found: ${request.workflowPath}`);
  const workflow = parseWorkflowFromMarkdown(await app.vault.read(file));
  const input: WorkflowInput = { variables: new Map() };
  const execution = await new WorkflowExecutor(app).execute(workflow, input, undefined, {
    workflowPath: file.path, workflowName: file.basename, recordHistory: false,
    abortSignal: request.abortSignal ?? new AbortController().signal,
  }, headlessCallbacks());
  const text = extractWorkflowOutput(execution.context.variables, request.outputVariable);
  if (text == null) throw new Error("Workflow output is not a string. Store it in `result`, or set Output variable.");
  return text;
}
