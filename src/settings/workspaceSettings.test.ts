import { describe, expect, it } from "vitest";
import { normalizeFolderInput } from "./workspaceSettings.js";

/**
 * The workspace folder row and the Vault tool allow-list both resolve what the
 * user typed through this one rule. The rows themselves are Obsidian UI and
 * cannot be exercised here, so this is what pins what they accept.
 */
describe("normalizeFolderInput", () => {
  it("keeps a plain vault-relative folder", () => {
    expect(normalizeFolderInput("LlmHub")).toBe("LlmHub");
    expect(normalizeFolderInput("Shared/Docs")).toBe("Shared/Docs");
  });

  it("treats surrounding slashes and whitespace as cosmetic", () => {
    expect(normalizeFolderInput("/LlmHub/")).toBe("LlmHub");
    expect(normalizeFolderInput("  /Shared/Docs/  ")).toBe("Shared/Docs");
  });

  it("refuses what the scope check cannot resolve", () => {
    expect(normalizeFolderInput("../escape")).toBeNull();
    expect(normalizeFolderInput("Shared/../Private")).toBeNull();
    expect(normalizeFolderInput("C:/Users")).toBeNull();
    expect(normalizeFolderInput("Shared\\Docs")).toBeNull();
  });

  it("keeps a folder whose name merely contains dots", () => {
    // The rule these rows used before tested for the substring "..", which also
    // refused a real folder named this way.
    expect(normalizeFolderInput("a..b")).toBe("a..b");
    expect(normalizeFolderInput("v1.2.3")).toBe("v1.2.3");
  });

  it("reports an empty entry rather than inventing a folder", () => {
    expect(normalizeFolderInput("")).toBeNull();
    expect(normalizeFolderInput("   ")).toBeNull();
    expect(normalizeFolderInput("///")).toBeNull();
  });
});
