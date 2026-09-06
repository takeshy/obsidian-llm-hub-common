import { describe, expect, it } from "vitest";
import {
  DELETE_VAULT_TOOL_NAMES,
  NEVER_ADVERTISED_VAULT_TOOL_NAMES,
  RAG_VAULT_TOOL_NAMES,
  READ_ONLY_VAULT_TOOL_NAMES,
  SEARCH_VAULT_TOOL_NAMES,
  VAULT_TOOL_DEFINITIONS,
  VAULT_TOOL_NAMES,
  WRITE_VAULT_TOOL_NAMES,
  filterVaultToolsForMode,
  getEnabledVaultTools,
  isVaultToolAllowed,
} from "./vaultTools.js";
import type { ToolPropertyDefinition } from "./provider.js";

const buckets = [
  READ_ONLY_VAULT_TOOL_NAMES,
  WRITE_VAULT_TOOL_NAMES,
  DELETE_VAULT_TOOL_NAMES,
  RAG_VAULT_TOOL_NAMES,
  NEVER_ADVERTISED_VAULT_TOOL_NAMES,
].map(bucket => [...bucket]);

describe("vault tool classification", () => {
  // A tool nobody classified silently never reaches a model: getEnabledVaultTools
  // ends in `return false`. This is the test that fails instead.
  it("sorts every definition into exactly one capability bucket", () => {
    const classified = buckets.flat();
    expect([...classified].sort()).toEqual([...VAULT_TOOL_NAMES].sort());
    expect(new Set(classified).size).toBe(classified.length);
  });

  it("keeps the search tools a subset of the read-only tools", () => {
    for (const name of SEARCH_VAULT_TOOL_NAMES) {
      expect(READ_ONLY_VAULT_TOOL_NAMES).toContain(name);
    }
  });

  it("only marks parameters required that the schema also declares", () => {
    const undeclared = (properties: Record<string, ToolPropertyDefinition>, required: string[] | undefined, path: string) =>
      (required ?? []).filter(key => !(key in properties)).map(key => `${path}.${key}`);

    const missing = VAULT_TOOL_DEFINITIONS.flatMap(tool => [
      ...undeclared(tool.parameters.properties, tool.parameters.required, tool.name),
      ...Object.entries(tool.parameters.properties).flatMap(([key, property]) => {
        const items = property.items;
        return items && "properties" in items && items.properties
          ? undeclared(items.properties, items.required, `${tool.name}.${key}[]`)
          : [];
      }),
    ]);
    expect(missing).toEqual([]);
  });
});

describe("getEnabledVaultTools", () => {
  const names = (capabilities: Parameters<typeof getEnabledVaultTools>[0]) =>
    getEnabledVaultTools(capabilities).map(tool => tool.name);

  it("advertises everything but the unconfirmed writers when fully capable", () => {
    expect(names({ allowWrite: true, allowDelete: true, ragSyncStatus: true }).sort())
      .toEqual(VAULT_TOOL_NAMES.filter(name => !NEVER_ADVERTISED_VAULT_TOOL_NAMES.includes(name)).sort());
  });

  it("never advertises update_note or delete_note, which skip the confirmation dialog", () => {
    const advertised = names({ allowWrite: true, allowDelete: true, ragSyncStatus: true });
    expect(advertised).not.toContain("update_note");
    expect(advertised).not.toContain("delete_note");
  });

  it("falls back to the read-only set when the host executes nothing else", () => {
    expect(names({ allowWrite: false, allowDelete: false, ragSyncStatus: false }).sort())
      .toEqual([...READ_ONLY_VAULT_TOOL_NAMES].sort());
  });

  it("hides get_rag_sync_status from hosts without a per-file sync index", () => {
    expect(names({ allowWrite: true, allowDelete: true, ragSyncStatus: false })).not.toContain("get_rag_sync_status");
    expect(names({ allowWrite: true, allowDelete: true, ragSyncStatus: true })).toContain("get_rag_sync_status");
  });
});

describe("isVaultToolAllowed", () => {
  const enabled = getEnabledVaultTools({ allowWrite: true, allowDelete: true, ragSyncStatus: true });

  it("exposes only read tools in readOnly mode", () => {
    expect(enabled.filter(tool => isVaultToolAllowed(tool.name, "readOnly")).map(tool => tool.name).sort())
      .toEqual([...READ_ONLY_VAULT_TOOL_NAMES].sort());
  });

  it("drops only the vault-wide scans in noSearch mode", () => {
    expect(enabled.filter(tool => !isVaultToolAllowed(tool.name, "noSearch")).map(tool => tool.name).sort())
      .toEqual([...SEARCH_VAULT_TOOL_NAMES].sort());
  });

  it("blocks every built-in tool in none mode and allows all of them in all mode", () => {
    expect(enabled.some(tool => isVaultToolAllowed(tool.name, "none"))).toBe(false);
    expect(enabled.every(tool => isVaultToolAllowed(tool.name, "all"))).toBe(true);
  });

  it("leaves MCP and skill tools to their own permissions", () => {
    for (const mode of ["all", "noSearch", "readOnly", "none"] as const) {
      expect(isVaultToolAllowed("mcp_external_tool", mode)).toBe(true);
      expect(isVaultToolAllowed("run_skill_workflow", mode)).toBe(true);
    }
  });
});

describe("filterVaultToolsForMode", () => {
  const tools = [{ name: "read_note" }, { name: "create_note" }, { name: "search_notes" }, { name: "mcp_external_tool" }];

  it("returns the same array untouched in all mode", () => {
    expect(filterVaultToolsForMode(tools, "all")).toBe(tools);
  });

  it("keeps read tools and foreign tools in readOnly mode", () => {
    expect(filterVaultToolsForMode(tools, "readOnly").map(tool => tool.name))
      .toEqual(["read_note", "search_notes", "mcp_external_tool"]);
  });

  it("drops the vault-wide scans in noSearch mode", () => {
    expect(filterVaultToolsForMode(tools, "noSearch").map(tool => tool.name))
      .toEqual(["read_note", "create_note", "mcp_external_tool"]);
  });

  it("removes every built-in vault tool in none mode", () => {
    expect(filterVaultToolsForMode(tools, "none").map(tool => tool.name)).toEqual(["mcp_external_tool"]);
  });
});
