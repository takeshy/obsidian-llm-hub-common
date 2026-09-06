import { TFile, type App } from "obsidian";
import { cryptoCache } from "../core/cryptoCache.js";
import type { McpAppInfo } from "../core/message.js";
import type { LoadedSkill, SkillWorkflowRef } from "../skills/skillsLoader.js";
import { promptForPassword } from "../ui/passwordPrompt.js";
import { promptForConfirmation } from "../ui/workflow/EditConfirmationModal.js";
import { promptForAnyFile, promptForFile, promptForNewFilePath } from "../ui/workflow/FilePromptModal.js";
import { promptForDialog } from "../ui/workflow/DialogPromptModal.js";
import { promptForSelection } from "../ui/workflow/SelectionPromptModal.js";
import { promptForValue } from "../ui/workflow/ValuePromptModal.js";
import { openMcpAppModal } from "../ui/workflow/McpAppModal.js";
import { WorkflowExecutionModal } from "../ui/workflow/WorkflowExecutionModal.js";
import { WorkflowExecutor } from "./executor.js";
import { parseWorkflowFromMarkdown } from "./parser.js";

/** A workflow a skill offers, as collectSkillWorkflows returns it. */
export interface SkillWorkflowEntry {
  skill: LoadedSkill;
  workflowRef: SkillWorkflowRef;
  vaultPath: string;
}

export interface SkillWorkflowRunOptions {
  /**
   * Folders the workflow's vault operations may touch; undefined or empty means
   * the whole vault. Required rather than optional: a host that confines its
   * chat's own tools and forgets this lets a workflow the model triggers write
   * anywhere, which is the same permission by another route.
   */
  vaultToolAllowedFolders: string[] | undefined;
}

/**
 * Run a workflow a skill offers, in the same execution modal the workflow panel
 * uses, and report the result to the model that asked for it.
 *
 * Failures come back as a value rather than an exception, with an instruction
 * not to retry: a workflow that failed usually needs the user, and a model left
 * to its own devices will run it again.
 */
export async function runSkillWorkflow(
  app: App,
  workflowId: string,
  variablesJson: string | undefined,
  workflows: Map<string, SkillWorkflowEntry>,
  options: SkillWorkflowRunOptions,
): Promise<Record<string, unknown>> {
  const entry = workflows.get(workflowId);
  if (!entry) {
    return { error: `Unknown workflow ID: ${workflowId}. Available: ${[...workflows.keys()].join(", ")}` };
  }

  const { vaultPath } = entry;
  const workflowDisplayName = vaultPath.substring(vaultPath.lastIndexOf("/") + 1).replace(/\.md$/, "") || workflowId;

  const file = app.vault.getAbstractFileByPath(vaultPath);
  if (!(file instanceof TFile)) {
    return { error: `Workflow file not found: ${vaultPath}`, workflowId, workflowPath: vaultPath };
  }

  let workflow;
  try {
    workflow = parseWorkflowFromMarkdown(await app.vault.read(file));
  } catch (e) {
    return {
      error: `Failed to parse workflow: ${e instanceof Error ? e.message : String(e)}`,
      workflowId,
      workflowPath: vaultPath,
    };
  }

  const variables = new Map<string, string | number>();
  if (variablesJson) {
    try {
      for (const [key, value] of Object.entries(JSON.parse(variablesJson) as Record<string, string | number>)) {
        variables.set(key, value);
      }
    } catch {
      return { error: `Invalid variables JSON: ${variablesJson}`, workflowId, workflowPath: vaultPath };
    }
  }

  const executor = new WorkflowExecutor(app);
  const abortController = new AbortController();
  const modal = new WorkflowExecutionModal(app, workflow, workflowDisplayName, abortController, () => {});
  modal.open();
  let executionModalRef: WorkflowExecutionModal | null = modal;

  const callbacks = {
    promptForFile: (defaultPath?: string, title?: string) =>
      promptForFile(app, title || defaultPath || "Select a file"),
    promptForAnyFile: (extensions?: string[], defaultPath?: string, title?: string) =>
      promptForAnyFile(app, extensions, title || defaultPath || "Select a file"),
    promptForNewFilePath: (extensions?: string[], defaultPath?: string, title?: string) =>
      promptForNewFilePath(app, extensions, defaultPath, title),
    promptForSelection: () => promptForSelection(app, "Select text"),
    promptForValue: (prompt: string, defaultValue?: string, multiline?: boolean) =>
      promptForValue(app, prompt, defaultValue || "", multiline || false),
    promptForConfirmation: (filePath: string, content: string, mode: string, originalContent?: string) =>
      promptForConfirmation(app, filePath, content, mode, originalContent),
    promptForDialog: (
      title: string, message: string, options: string[], multiSelect: boolean,
      button1: string, button2?: string, markdown?: boolean, inputTitle?: string,
      defaults?: { input?: string; selected?: string[] }, multiline?: boolean,
    ) => promptForDialog(app, title, message, options, multiSelect, button1, button2, markdown, inputTitle, defaults, multiline),
    openFile: async (notePath: string) => {
      const noteFile = app.vault.getAbstractFileByPath(notePath);
      if (noteFile instanceof TFile) await app.workspace.getLeaf().openFile(noteFile);
    },
    promptForPassword: async () => cryptoCache.getPassword() || promptForPassword(app),
    showMcpApp: async (mcpApp: McpAppInfo) => {
      if (executionModalRef) await openMcpAppModal(app, mcpApp);
    },
    onThinking: (nodeId: string, thinking: string) => {
      executionModalRef?.updateThinking(nodeId, thinking);
    },
  };

  try {
    const result = await executor.execute(
      workflow,
      { variables },
      (log) => executionModalRef?.updateFromLog(log),
      {
        workflowPath: vaultPath,
        workflowName: workflowDisplayName,
        recordHistory: true,
        abortSignal: abortController.signal,
        vaultToolAllowedFolders: options.vaultToolAllowedFolders,
      },
      callbacks,
    );

    modal.setComplete(true);

    // Internal bookkeeping variables are not part of the answer.
    const outputVars: Record<string, string | number> = {};
    result.context.variables.forEach((value, key) => {
      if (!key.startsWith("__")) outputVars[key] = value;
    });

    const fileNodeTypes = new Set(["note", "file-save"]);
    const savedFiles = result.context.logs
      .filter((log) => fileNodeTypes.has(log.nodeType) && log.status === "success" && typeof log.output === "string")
      .map((log) => log.output as string);

    return {
      success: true,
      workflowId,
      variables: outputVars,
      logs: result.context.logs.map((log) => ({ node: log.nodeType, status: log.status, message: log.message })),
      ...(savedFiles.length > 0 ? { savedFiles } : {}),
    };
  } catch (e) {
    modal.setComplete(false);
    return {
      error: `Workflow execution failed: ${e instanceof Error ? e.message : String(e)}. Do not retry automatically — report the error to the user and ask how to proceed.`,
      workflowId,
      workflowPath: vaultPath,
    };
  } finally {
    executionModalRef = null;
  }
}
