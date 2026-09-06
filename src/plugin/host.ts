import type { App, Command, EventRef } from "obsidian";

/**
 * The slice of the Obsidian plugin API these managers need. An Obsidian `Plugin` satisfies it, so a
 * host passes itself in without this package depending on the plugin class.
 */
export interface PluginRuntime {
  app: App;
  addCommand(command: Command): void;
  registerEvent(ref: EventRef): void;
}
