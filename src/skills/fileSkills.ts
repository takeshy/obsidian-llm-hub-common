import { builtinFolderPath } from "./builtinSkills.js";
import { runtimeSkillPath } from "./runtimeSkills.js";

/** The kinds of vault file a skill knows how to edit. */
export type FileSkillKind = "markdown" | "canvas" | "base" | "dashboard";

export interface FileSkill {
  kind: FileSkillKind;
  skillPath: string;
}

export const DASHBOARD_SKILL_PATH = runtimeSkillPath("dashboard-hub", "dashboard");

const FILE_SKILLS: Record<string, FileSkill> = {
  md: { kind: "markdown", skillPath: builtinFolderPath("obsidian-markdown") },
  canvas: { kind: "canvas", skillPath: builtinFolderPath("json-canvas") },
  base: { kind: "base", skillPath: builtinFolderPath("base") },
  dashboard: { kind: "dashboard", skillPath: DASHBOARD_SKILL_PATH },
};

/**
 * The skill that helps edit a file with this extension. It is only suggested to
 * the user; opening a file never switches a skill on by itself.
 */
export function fileSkillFor(extension: string | undefined): FileSkill | null {
  return extension ? FILE_SKILLS[extension.toLowerCase()] ?? null : null;
}
