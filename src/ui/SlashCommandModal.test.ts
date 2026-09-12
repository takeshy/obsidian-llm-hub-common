import { describe, expect, it } from "vitest";
import {
  createBlankSlashCommand,
  decodeSearchSelection,
  encodeSearchSelection,
} from "./SlashCommandModal.js";

describe("search selection dropdown values", () => {
  it("round-trips every Web/RAG combination", () => {
    const selections = [
      null,
      { webSearch: false, ragSetting: null },
      { webSearch: true, ragSetting: null },
      { webSearch: false, ragSetting: "Research" },
      { webSearch: true, ragSetting: "Research" },
    ];
    for (const selection of selections) {
      expect(decodeSearchSelection(encodeSearchSelection(selection))).toEqual(selection);
    }
  });

  it("survives index names containing the separator", () => {
    // "rag:" and "both:" prefix the encoded name, so a raw ":" would truncate it.
    for (const name of ["a:b", "100% notes", "papers/2026"]) {
      const selection = { webSearch: true, ragSetting: name };
      expect(decodeSearchSelection(encodeSearchSelection(selection))).toEqual(selection);
    }
  });

  it("distinguishes \"keep the current setting\" from \"no search\"", () => {
    expect(encodeSearchSelection(null)).not.toBe(encodeSearchSelection({ webSearch: false, ragSetting: null }));
    expect(decodeSearchSelection(encodeSearchSelection(undefined))).toBeNull();
  });
});

describe("createBlankSlashCommand", () => {
  it("writes no key for a capability the host did not declare", () => {
    const blank = createBlankSlashCommand({});
    expect(Object.keys(blank).sort()).toEqual(["description", "id", "name", "promptTemplate", "vaultToolMode"]);
  });

  it("adds one key per declared capability, each meaning \"keep the current setting\"", () => {
    const blank = createBlankSlashCommand({
      models: [{ name: "m", displayName: "M" }],
      search: { webSearch: true, ragSettings: [], combinable: true },
      mcpServers: [{ name: "server", enabled: true }],
      skills: [{ name: "Writer", folderPath: "skills/writer" }],
    });
    expect(blank.model).toBeNull();
    expect(blank.searchSelection).toBeNull();
    expect(blank.enabledMcpServers).toBeNull();
    expect(blank.skillPath).toBeNull();
    expect(blank.vaultToolMode).toBeNull();
  });

  it("gives each command its own id", () => {
    expect(createBlankSlashCommand({}).id).not.toBe(createBlankSlashCommand({}).id);
  });
});
