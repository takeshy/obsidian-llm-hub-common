import { describe, expect, it } from "vitest";
import { prunedSkillPaths, restoredSkillPaths } from "./skillSelection.js";
import { builtinFolderPath, DEFAULT_BUILTIN_SKILL_IDS } from "./builtinSkills.js";

const defaults = DEFAULT_BUILTIN_SKILL_IDS.map(builtinFolderPath);

describe("restoredSkillPaths", () => {
  it("brings back a selection the user built from their own skills", () => {
    // Kept exactly: nothing is added, so a built-in switched off stays off.
    expect(restoredSkillPaths(["skills/my-writing"], defaults)).toEqual(["skills/my-writing"]);
    expect(restoredSkillPaths(["skills/my-writing", ...defaults], defaults))
      .toEqual(["skills/my-writing", ...defaults]);
  });

  it("leaves a selection of only built-in skills to the defaults", () => {
    // The shipped set is a starting point, not a choice, so a release may change
    // it without a stale copy following the user around.
    expect(restoredSkillPaths(defaults, defaults)).toEqual(defaults);
    expect(restoredSkillPaths([], defaults)).toEqual(defaults);
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
