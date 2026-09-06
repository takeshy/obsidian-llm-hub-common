import type { App } from "obsidian";

/**
 * What a settings section needs from the tab around it. Generic over the plugin, since each
 * section reads a different slice of its settings.
 */
export interface SettingsContext<TPlugin> {
  plugin: TPlugin;
  /** Redraws the settings tab after a change that alters what is shown. */
  display: () => void;
  /** Mutable flag a long-running sync watches for cancellation. */
  syncCancelRef: { value: boolean };
}

/** The plugin surface shared settings sections rely on. */
export interface SettingsPlugin {
  app: App;
  manifest: { id: string; version: string };
  saveSettings(): Promise<void>;
}
