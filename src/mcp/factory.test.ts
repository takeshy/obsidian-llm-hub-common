import { describe, it, expect, vi, beforeEach } from "vitest";
import { configureMcpStdioClient, createMcpClient } from "./factory.js";
import { McpHttpClient } from "./httpClient.js";
import type { McpServerConfig } from "../core/mcpTypes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Only identity is checked.
const stubStdio = { close: () => Promise.resolve() } as any;

beforeEach(() => { vi.resetModules(); });

describe("createMcpClient", () => {
  it("uses HTTP for a server with a URL", () => {
    const config: McpServerConfig = { name: "Anki", transport: "http", url: "http://localhost:1", enabled: true };
    expect(createMcpClient(config)).toBeInstanceOf(McpHttpClient);
  });

  it("uses the registered stdio transport for a locally spawned server", () => {
    configureMcpStdioClient(() => stubStdio);
    const config: McpServerConfig = { name: "files", transport: "stdio", command: "npx", enabled: true };
    expect(createMcpClient(config)).toBe(stubStdio);
  });

  it("treats a command without a URL as stdio, even from settings that predate the field", () => {
    configureMcpStdioClient(() => stubStdio);
    expect(createMcpClient({ name: "files", command: "npx", enabled: true })).toBe(stubStdio);
  });

  it("says which server it cannot start rather than failing anonymously", async () => {
    const { createMcpClient: fresh } = await import("./factory.js");
    expect(() => fresh({ name: "files", transport: "stdio", command: "npx", enabled: true }))
      .toThrow(/"files"/);
  });

  it("refuses an HTTP server with no endpoint instead of sending requests nowhere", () => {
    expect(() => createMcpClient({ name: "broken", transport: "http", enabled: true }))
      .toThrow(/no URL/);
  });
});
