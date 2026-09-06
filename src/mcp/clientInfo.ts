/** How this plugin introduces itself to an MCP server. */
export interface McpClientInfo {
  name: string;
  version: string;
}

let info: McpClientInfo = { name: "obsidian-llm-hub-common", version: "1.0.0" };

/** Call once at plugin load, so servers see which plugin is talking to them. */
export function configureMcpClientInfo(value: McpClientInfo): void {
  info = value;
}

export function mcpClientInfo(): McpClientInfo {
  return info;
}
