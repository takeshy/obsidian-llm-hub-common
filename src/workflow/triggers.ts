/** Obsidian events a workflow can be started by. */
export type ObsidianEventType =
  | "startup"   // workspace.onLayoutReady() - Workspace ready after startup
  | "create"    // vault.on("create") - New file created
  | "modify"    // vault.on("modify") - File modified/saved
  | "delete"    // vault.on("delete") - File deleted
  | "rename"    // vault.on("rename") - File renamed
  | "file-open"; // workspace.on("file-open") - File opened

// Event trigger configuration for workflows
export interface WorkflowEventTrigger {
  workflowId: string;        // Vault path to the workflow file (e.g., "folder/file.md"). Each file holds exactly one workflow.
  events: ObsidianEventType[]; // Which events trigger this workflow
  filePattern?: string;       // Optional glob pattern to filter files (e.g., "*.md", "folder/**")
}
