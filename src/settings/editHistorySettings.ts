
import type { SettingsContext, SettingsPlugin } from "./context.js";
/** What this section reads and writes. */
import { DEFAULT_EDIT_HISTORY_SETTINGS } from "./types.js";

/** What this section reads and writes. */
export interface EditHistorySettingsPlugin extends SettingsPlugin {
  settings: { editHistory: { enabled: boolean; diff: { contextLines: number } } };
}

export function displayEditHistorySettings(_containerEl: HTMLElement, ctx: SettingsContext<EditHistorySettingsPlugin>): void {
  const { plugin } = ctx;

  // Edit history is always enabled with fixed context lines — no UI needed.
  // Ensure settings exist with defaults.
  if (!plugin.settings.editHistory) {
    plugin.settings.editHistory = { ...DEFAULT_EDIT_HISTORY_SETTINGS };
  }
  plugin.settings.editHistory.enabled = true;
}
