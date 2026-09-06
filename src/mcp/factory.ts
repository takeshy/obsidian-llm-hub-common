import type { McpServerConfig } from "../core/mcpTypes.js";
import { McpHttpClient, type IMcpClient } from "./httpClient.js";

/** Builds the client for a locally spawned server; hosts that support stdio register one. */
export type McpStdioClientFactory = (config: McpServerConfig) => IMcpClient;

let createStdioClient: McpStdioClientFactory | undefined;

/**
 * Register the stdio transport. Hosts do this at load; keeping it out of this module means
 * a mobile build never pulls Node's child_process into its startup path.
 */
export function configureMcpStdioClient(factory: McpStdioClientFactory): void {
  createStdioClient = factory;
}

/**
 * Whether this host can start a local process for a server. The settings UI asks
 * before offering the stdio transport, so what the form offers and what the
 * factory accepts cannot disagree.
 */
export function hasMcpStdioClient(): boolean {
  return !!createStdioClient;
}

/** Create the client a server config asks for. */
export function createMcpClient(config: McpServerConfig): IMcpClient {
  if (config.transport === "stdio" || (!config.url && config.command)) {
    if (!createStdioClient) {
      throw new Error(`MCP server "${config.name}" needs a local process, which this plugin cannot start`);
    }
    return createStdioClient(config);
  }
  return new McpHttpClient(config);
}
