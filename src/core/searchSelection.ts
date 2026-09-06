import type { SearchSelection } from "./events.js";

export const EMPTY_SEARCH_SELECTION: SearchSelection = { webSearch: false, ragSetting: null };

/**
 * The composer lets Web search and a RAG index be picked independently, but the
 * setting they replaced was a single choice: "", "__websearch__", or an index
 * name. Stored slash commands and workspace state still carry that shape, so it
 * is converted on read rather than rewritten in place.
 */
export function searchSelectionFromLegacy(value: string | null | undefined): SearchSelection | null {
  if (value === null || value === undefined) return null;
  if (value === "") return { ...EMPTY_SEARCH_SELECTION };
  if (value === "__websearch__") return { webSearch: true, ragSetting: null };
  return { webSearch: false, ragSetting: value };
}

/** A slash command's search override, or null to keep whatever the chat has. */
export function getSlashCommandSearchSelection(
  command: { searchSelection?: SearchSelection | null; searchSetting?: string | null },
): SearchSelection | null {
  if (command.searchSelection !== undefined) {
    return command.searchSelection === null ? null : normalizeSearchSelection(command.searchSelection);
  }
  return searchSelectionFromLegacy(command.searchSetting);
}

export function normalizeSearchSelection(value: SearchSelection): SearchSelection {
  return {
    webSearch: value.webSearch === true,
    ragSetting: typeof value.ragSetting === "string" && value.ragSetting.length > 0
      ? value.ragSetting
      : null,
  };
}

/** Workspace state kept the RAG name and the Web toggle apart, with "__websearch__" as a RAG name. */
export function searchSelectionFromWorkspace(
  selectedRagSetting: string | null | undefined,
  webSearchEnabled: boolean | undefined,
): SearchSelection {
  if (selectedRagSetting === "__websearch__") return { webSearch: true, ragSetting: null };
  return normalizeSearchSelection({
    webSearch: webSearchEnabled === true,
    ragSetting: selectedRagSetting ?? null,
  });
}

/**
 * What the current model can actually do with the remembered preferences.
 * Returns a copy: switching to a model without Web search must not forget that
 * the user wants it back on the next model that has it.
 */
export function getEffectiveSearchSelection(
  selection: SearchSelection,
  webSearchSupported: boolean,
  ragSupported: boolean,
): SearchSelection {
  return {
    webSearch: selection.webSearch && webSearchSupported,
    ragSetting: ragSupported ? selection.ragSetting : null,
  };
}
