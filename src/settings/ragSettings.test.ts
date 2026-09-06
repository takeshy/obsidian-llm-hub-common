import { describe, expect, it, vi } from "vitest";
import { addExcludePatternsSetting, addTargetFoldersSetting, type RagIndexScope } from "./ragSettings.js";
import { matchFilePattern } from "../core/globMatcher.js";

vi.mock("obsidian", () => {
  const field = {
    setPlaceholder: () => field,
    setValue: () => field,
    onChange: (handler: (value: string) => void) => { captured.onChange = handler; return field; },
    inputEl: { rows: 0, addClass() {} },
  };
  class Setting {
    settingEl = { addClass() {} };
    setName() { return this; }
    setDesc() { return this; }
    addText(build: (f: typeof field) => unknown) { build(field); return this; }
    addTextArea(build: (f: typeof field) => unknown) { build(field); return this; }
  }
  return { Setting, Notice: class {}, Modal: class {} };
});
vi.mock("../i18n/index.js", () => ({ t: (key: string) => key }));

const captured = vi.hoisted(() => ({ onChange: undefined as ((value: string) => void) | undefined }));


/** Render a row, type into it, and return what it asked to save. */
function type(
  add: (el: HTMLElement, scope: RagIndexScope, save: (updates: Partial<RagIndexScope>) => Promise<void>) => void,
  typed: string,
): Partial<RagIndexScope> | undefined {
  const saved: Partial<RagIndexScope>[] = [];
  add({} as HTMLElement, { targetFolders: [], excludePatterns: [] }, async (updates) => { saved.push(updates); });
  captured.onChange?.(typed);
  return saved[0];
}

describe("target folders row", () => {
  it("splits on commas and drops blanks", () => {
    expect(type(addTargetFoldersSetting, " Notes , , Projects/Docs "))
      .toEqual({ targetFolders: ["Notes", "Projects/Docs"] });
  });
});

describe("exclude patterns row", () => {
  it("keeps one glob per line, so brace expansion survives", () => {
    // Splitting this on commas would store "**/{tmp" and "cache}/**" instead,
    // and neither half excludes anything.
    const pattern = "**/{tmp,cache}/**";
    expect(type(addExcludePatternsSetting, `${pattern}\n  \n*.png`))
      .toEqual({ excludePatterns: [pattern, "*.png"] });
    expect(matchFilePattern(pattern, "Notes/tmp/a.md")).toBe(true);
    expect(matchFilePattern("**/{tmp", "Notes/tmp/a.md")).toBe(false);
  });
});
