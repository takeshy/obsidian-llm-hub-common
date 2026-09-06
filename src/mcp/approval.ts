import type { McpServerConfig } from "../core/mcpTypes.js";
import { normalizeSpawnCommand } from "./commandLine.js";

export type McpApprovalDecision = "once" | "always" | "deny";
export interface McpApprovalHandler {
  getServer: (server: McpServerConfig) => McpServerConfig | undefined;
  request: (server: McpServerConfig, tool: string, args: Record<string, unknown>, canRemember: boolean) => Promise<McpApprovalDecision>;
  remember: (server: McpServerConfig, tool: string) => Promise<void>;
}

let handler: McpApprovalHandler | undefined;
let pending: Promise<unknown> = Promise.resolve();

export function setMcpApprovalHandler(value: McpApprovalHandler | undefined): void {
  handler = value;
}

/**
 * Whether two configurations describe the same connection. Approval is remembered per
 * connection, so every detail that changes where a tool call actually goes is compared —
 * permission must never transfer to a different endpoint or a different executable.
 */
export function sameMcpConnection(a: McpServerConfig, b: McpServerConfig): boolean {
  const recordKey = (value?: Record<string, string>) =>
    JSON.stringify(Object.entries(value ?? {}).sort(([left], [right]) => left.localeCompare(right)));
  const transport = (config: McpServerConfig) => config.transport ?? (config.command ? "stdio" : "http");
  if (transport(a) !== transport(b)) return false;
  if (a.id !== b.id) return false;

  if (transport(a) === "stdio") {
    // Compare the command as it will actually be spawned: "npx -y x" and ["npx", "-y", "x"]
    // are the same process, and a shell wrapper is not a different server.
    const left = normalizeSpawnCommand(a.command ?? "", a.args ?? []);
    const right = normalizeSpawnCommand(b.command ?? "", b.args ?? []);
    return left.command === right.command
      && JSON.stringify(left.args) === JSON.stringify(right.args)
      && recordKey(a.env) === recordKey(b.env)
      && a.cwd === b.cwd
      && a.pluginRoot === b.pluginRoot
      && a.pluginData === b.pluginData;
  }
  return a.url === b.url && recordKey(a.headers) === recordKey(b.headers);
}

export function requireMcpApproval(server: McpServerConfig, tool: string, args: Record<string, unknown>): Promise<void> {
  const current = handler;
  const run = async () => {
    if (!current || current !== handler) throw new Error("MCP tool approval is unavailable");
    const saved = current.getServer(server);
    if (saved?.autoApprove || saved?.allowedTools?.includes(tool)) return;
    const decision = await current.request(saved ?? server, tool, args, !!saved);
    if (current !== handler || decision === "deny") throw new Error(`MCP tool call denied by user: ${tool}`);
    if (decision === "always") {
      const latest = current.getServer(server);
      if (!latest) throw new Error("MCP server settings changed during approval");
      await current.remember(latest, tool);
    }
  };
  const result = pending.then(run);
  pending = result.catch(() => {});
  return result;
}
