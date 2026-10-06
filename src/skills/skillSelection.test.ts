import { describe, expect, it } from "vitest";
import { prunedSkillPaths, restoredSkillPaths } from "./skillSelection.js";
import { builtinFolderPath } from "./builtinSkills.js";

const defaults = [builtinFolderPath("obsidian-markdown")];

describe("restoredSkillPaths", () => {
  it("carries over the previous selection exactly", () => {
    // Nothing is added, so a built-in switched off stays off.
    expect(restoredSkillPaths(["skills/my-writing"], defaults)).toEqual(["skills/my-writing"]);
    expect(restoredSkillPaths(["skills/my-writing", ...defaults], defaults))
      .toEqual(["skills/my-writing", ...defaults]);
    expect(restoredSkillPaths(defaults, defaults)).toEqual(defaults);
  });

  it("keeps an empty selection empty", () => {
    expect(restoredSkillPaths([], defaults)).toEqual([]);
  });

  it("starts from the defaults only when nothing was ever saved", () => {
    expect(restoredSkillPaths(undefined, defaults)).toEqual(defaults);
  });
});

describe("prunedSkillPaths", () => {
  it("drops skills that no longer exist", () => {
    const available = [{ folderPath: "skills/my-writing" }, { folderPath: defaults[0] }];
    expect(prunedSkillPaths(["skills/my-writing", "skills/renamed", defaults[0]], available))
      .toEqual(["skills/my-writing", defaults[0]]);
  });
});
