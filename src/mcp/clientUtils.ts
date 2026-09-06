// Shared utilities for MCP client implementations

import type { McpAppResult, McpAppUiResource } from "../core/message.js";
import type { McpServerConfig } from "../core/mcpTypes.js";
import type { McpToolCallResult, McpResourceReadResult, IMcpClient } from "./httpClient.js";

/**
 * Map McpToolCallResult to McpAppResult (shared between HTTP and stdio transports)
 */
export function mapToolCallToAppResult(result: McpToolCallResult): McpAppResult {
  return {
    content: result.content?.map(c => ({
      type: c.type,
      text: c.text,
      data: c.data,
      mimeType: c.mimeType,
      resource: c.resource,
    })) || [],
    isError: result.isError,
    structuredContent: result.structuredContent,
    _meta: result._meta,
  };
}

/**
 * Map McpResourceReadResult to McpAppUiResource (shared between HTTP and stdio transports)
 */
export function mapResourceReadResult(result: McpResourceReadResult): McpAppUiResource | null {
  if (result.contents && result.contents.length > 0) {
    const content = result.contents[0];
    return {
      uri: content.uri,
      mimeType: content.mimeType || "text/html",
      text: content.text,
      blob: content.blob,
      _meta: content._meta,
    };
  }
  return null;
}

/**
 * Create an MCP client for a stored app: from the full server config when the message
 * carried one, otherwise from the URL and headers older messages recorded.
 */
export function createClientFromAppInfo(
  serverConfig?: McpServerConfig,
  serverUrl?: string,
  serverHeaders?: Record<string, string>,
): IMcpClient {
  // Lazy import to avoid a cycle: the factory reaches back into this module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Resolve the circular client dependency only when an MCP app is created.
  const { createMcpClient } = require("./factory.js") as typeof import("./factory.js");
  return createMcpClient(serverConfig ?? {
    name: "mcp-app",
    transport: "http",
    url: serverUrl || "",
    headers: serverHeaders,
    enabled: true,
  });
}
