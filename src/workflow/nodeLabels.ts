import type { WorkflowNodeType } from "./types.js";
import { t } from "../i18n/index.js";

/** The translation key for each node type. One map, so no host can miss a type. */
export const WORKFLOW_NODE_LABEL_KEYS: Record<WorkflowNodeType, string> = {
  variable: "workflow.nodeType.variable",
  set: "workflow.nodeType.set",
  if: "workflow.nodeType.if",
  while: "workflow.nodeType.while",
  command: "workflow.nodeType.command",
  http: "workflow.nodeType.http",
  json: "workflow.nodeType.json",
  note: "workflow.nodeType.note",
  "note-read": "workflow.nodeType.noteRead",
  "note-search": "workflow.nodeType.noteSearch",
  "note-list": "workflow.nodeType.noteList",
  "folder-list": "workflow.nodeType.folderList",
  open: "workflow.nodeType.open",
  dialog: "workflow.nodeType.dialog",
  "prompt-file": "workflow.nodeType.promptFile",
  "prompt-selection": "workflow.nodeType.promptSelection",
  "file-explorer": "workflow.nodeType.fileExplorer",
  "file-save": "workflow.nodeType.fileSave",
  workflow: "workflow.nodeType.workflow",
  "rag-sync": "workflow.nodeType.ragSync",
  mcp: "workflow.nodeType.mcp",
  "obsidian-command": "workflow.nodeType.obsidianCommand",
  sleep: "workflow.nodeType.sleep",
  script: "workflow.nodeType.script",
  shell: "workflow.nodeType.shell",
};

/** Node type labels in the current locale. */
export function getWorkflowNodeTypeLabels(): Record<WorkflowNodeType, string> {
  return Object.fromEntries(
    Object.entries(WORKFLOW_NODE_LABEL_KEYS).map(([type, key]) => [type, t(key)]),
  ) as Record<WorkflowNodeType, string>;
}

export function getWorkflowNodeTypeLabel(type: WorkflowNodeType): string {
  return t(WORKFLOW_NODE_LABEL_KEYS[type] ?? type);
}
