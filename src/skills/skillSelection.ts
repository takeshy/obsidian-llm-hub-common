import { isBuiltinSkillPath } from "./builtinSkills.js";
import type { SkillMetadata } from "./skillsLoader.js";

/**
 * The skill selection a chat starts with.
 *
 * A selection the user built out of their own skills is a standing preference:
 * they went looking for it, and having every new chat forget it is what made the
 * feature tedious. It comes back exactly as it was - nothing is added to it, so a
 * built-in skill the user switched off stays off.
 *
 * A selection that holds only built-in skills is left to the defaults instead.
 * Those are the shipped starting point rather than a choice, so they can change
 * with a release without a stale copy following the user around.
 */
export function restoredSkillPaths(
  persisted: readonly string[] | undefined,
  defaults: readonly string[],
): string[] {
  if (!persisted?.some((path) => !isBuiltinSkillPath(path))) return [...defaults];
  return [...persisted];
}

/**
 * Drop selected skills that no longer exist. A saved selection outlives the
 * folders it names: a skill can be renamed, deleted, or belong to an agent
 * plugin that is no longer enabled.
 */
export function prunedSkillPaths(
  paths: readonly string[],
  available: readonly Pick<SkillMetadata, "folderPath">[],
): string[] {
  const known = new Set(available.map((skill) => skill.folderPath));
  return paths.filter((path) => known.has(path));
}
