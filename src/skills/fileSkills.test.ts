import { describe, expect, it } from "vitest";
import { DASHBOARD_SKILL_PATH, fileSkillFor } from "./fileSkills.js";
import { builtinFolderPath } from "./builtinSkills.js";

describe("fileSkillFor", () => {
  it("maps editable file types to their skill", () => {
    expect(fileSkillFor("md")).toEqual({ kind: "markdown", skillPath: builtinFolderPath("obsidian-markdown") });
    expect(fileSkillFor("canvas")).toEqual({ kind: "canvas", skillPath: builtinFolderPath("json-canvas") });
    expect(fileSkillFor("base")).toEqual({ kind: "base", skillPath: builtinFolderPath("base") });
    expect(fileSkillFor("dashboard")).toEqual({ kind: "dashboard", skillPath: DASHBOARD_SKILL_PATH });
  });

  it("has nothing for other files", () => {
    expect(fileSkillFor("pdf")).toBeNull();
    expect(fileSkillFor(undefined)).toBeNull();
  });
});
