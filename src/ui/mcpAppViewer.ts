import type { App } from "obsidian";

/**
 * Showing an MCP app needs the host's own modal, and only the hosts with MCP support have one.
 * They register it at load; shared UI asks whether one exists before offering the button.
 */
type McpAppViewer = (app: App, mcpApp: unknown) => void | Promise<void>;

let viewer: McpAppViewer | null = null;

export function configureMcpAppViewer(next: McpAppViewer): void {
  viewer = next;
}

export function canShowMcpApp(): boolean {
  return viewer !== null;
}

export function showMcpApp(app: App, mcpApp: unknown): void {
  void viewer?.(app, mcpApp);
}
