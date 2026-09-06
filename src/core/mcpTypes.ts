/** How a plugin reaches an MCP server. Shared so agent-plugin installs can describe theirs. */
export type McpTransport = "http" | "stdio";
export type McpFraming = "content-length" | "newline";

export interface McpServerConfig {
  name: string;           // Server display name
  transport: McpTransport; // "http" (Streamable HTTP) or "stdio" (local process)
  // HTTP transport fields
  url: string;            // Streamable HTTP endpoint URL (used for HTTP transport)
  headers?: Record<string, string>;  // Optional headers for authentication (HTTP only)
  // Stdio transport fields (desktop only)
  command?: string;        // Executable command (e.g., "npx", "uvx", "/path/to/server")
  args?: string[];         // Command arguments (e.g., ["-y", "@mcp/server"])
  env?: Record<string, string>;  // Environment variables for the child process
  framing?: McpFraming;    // Framing protocol: "newline" (standard/default) or legacy "content-length"
  cwd?: string;
  pluginRoot?: string;
  pluginData?: string;
  agentPlugin?: { pluginName: string; serverName: string };
  // Common
  enabled: boolean;       // Whether this server is enabled for chat
  autoApprove?: boolean; // Skip approval for all tools on this server
  allowedTools?: string[]; // Exact MCP tool names approved by the user
  toolHints?: string[];   // Tool names from test connection (for display hints)
}
