import type { App } from "obsidian";
import { getClassPrefix } from "../core/classPrefix.js";

/**
 * Remembered UI choices live in Obsidian's local storage under a per-plugin key, so two plugins
 * installed side by side keep their own. Hosts whose storage keys differ from their class prefix
 * declare one; the rest inherit it.
 */
let storagePrefix: string | null = null;

export function configureStoragePrefix(prefix: string): void {
  storagePrefix = prefix;
}

function key(name: string): string {
  return `${storagePrefix ?? getClassPrefix()}-${name}`;
}

export type DiffViewMode = "unified" | "split";

export function getDiffViewModePreference(app: App): DiffViewMode {
  return app.loadLocalStorage(key("diff-view-mode")) === "unified" ? "unified" : "split";
}

export function setDiffViewModePreference(app: App, viewMode: DiffViewMode): void {
  app.saveLocalStorage(key("diff-view-mode"), viewMode);
}

export function getDiffFullscreenPreference(app: App): boolean {
  const stored: unknown = app.loadLocalStorage(key("diff-fullscreen"));
  return stored === true || stored === "true";
}

export function setDiffFullscreenPreference(app: App, fullscreen: boolean): void {
  // Obsidian clears local storage entries for falsy values, so keep both states
  // as strings to ensure a restored windowed preference is explicit.
  app.saveLocalStorage(key("diff-fullscreen"), fullscreen ? "true" : "false");
}

export function getOpenFileAfterApplyPreference(app: App): boolean {
  const stored: unknown = app.loadLocalStorage(key("open-file-after-apply"));
  return stored === false || stored === "false" ? false : true;
}

export function setOpenFileAfterApplyPreference(app: App, value: boolean): void {
  // Stored as a string for the same reason: a boolean false would be dropped.
  app.saveLocalStorage(key("open-file-after-apply"), value ? "true" : "false");
}
