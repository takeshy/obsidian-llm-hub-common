import type { SkillMetadata } from "./skillsLoader.js";

/**
 * The skill selection a chat starts with.
 *
 * A new chat carries over the selection of the previous one exactly as it was,
 * including an empty one: a user who switched every skill off gets no skills,
 * and a built-in skill the user switched off stays off.
 *
 * Only a user who has never touched the list (nothing persisted yet) starts
 * from the shipped defaults.
 */
export function restoredSkillPaths(
  persisted: readonly string[] | undefined,
  defaults: readonly string[],
): string[] {
  return persisted ? [...persisted] : [...defaults];
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
