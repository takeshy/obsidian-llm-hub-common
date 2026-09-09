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

export function resolveEffectiveSkillPaths(
	activeSkillPaths: string[],
	activeContextSkillPath: string | null,
	disabledContextSkillPaths: ReadonlySet<string>,
	contextSkillPaths: ReadonlySet<string>,
	requestedSkillPath?: string,
): string[] {
	let effectiveSkillPaths = activeSkillPaths;
	if (requestedSkillPath && !effectiveSkillPaths.includes(requestedSkillPath)) {
		effectiveSkillPaths = [...effectiveSkillPaths, requestedSkillPath];
	}

	// A skill explicitly requested for this send takes precedence over the
	// automatically selected context skill, even when it was disabled in the UI.
	if (requestedSkillPath && contextSkillPaths.has(requestedSkillPath)) {
		return effectiveSkillPaths.filter(path =>
			!contextSkillPaths.has(path) || path === requestedSkillPath
		);
	}

	if (!activeContextSkillPath || disabledContextSkillPaths.has(activeContextSkillPath)) {
		return effectiveSkillPaths;
	}

	const withoutContextSkills = effectiveSkillPaths.filter(path => !contextSkillPaths.has(path));
	return [activeContextSkillPath, ...withoutContextSkills];
}
