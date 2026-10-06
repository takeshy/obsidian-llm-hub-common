import { useEffect, useRef } from "react";

/**
 * Save the skill selection whenever it changes - but not the value it started
 * with, so opening a chat view never writes settings for a user who has not
 * touched the list. The save runs after the render that changed it, keeping the
 * state updaters free of side effects.
 */
export function useSkillPathPersistence(paths: string[], save: (paths: readonly string[]) => void): void {
  const saved = useRef(paths);
  useEffect(() => {
    if (saved.current === paths) return;
    saved.current = paths;
    save(paths);
  }, [paths, save]);
}

/**
 * The skills for one send: the user's selection plus a skill a slash command
 * asks for, without changing the selection itself.
 */
export function withRequestedSkillPath(activeSkillPaths: string[], requestedSkillPath?: string): string[] {
  if (!requestedSkillPath || activeSkillPaths.includes(requestedSkillPath)) return activeSkillPaths;
  return [...activeSkillPaths, requestedSkillPath];
}
