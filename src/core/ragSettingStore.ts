/**
 * The parts of the workspace state that name RAG settings. What a setting holds
 * differs by plugin, but a setting's name is also the name of the directory its
 * index lives in, and every plugin has to keep the two in step.
 */
export interface NamedRagSettingsState<T> {
  selectedRagSetting: string | null;
  ragSettings: Record<string, T>;
}

/**
 * A setting that can be built out of other settings, where the host supports it.
 * The functions below read this off any setting shape: a host whose settings
 * have no sources simply never has the field, and the loops skip it.
 */
export interface RagSettingSources {
  sourceRagSettings?: string[];
}

/** Read a setting as one that may list sources, whether or not this host's do. */
function withSources<T>(settings: T[]): (T & RagSettingSources)[] {
  return settings as (T & RagSettingSources)[];
}

/**
 * The directory-safe form of a setting name. Index files are stored under it,
 * so two names that reduce to the same string would share one directory:
 * syncing either would overwrite the other's vectors, and deleting either would
 * take both.
 */
export function sanitizeRagSettingName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Refuse a name whose directory an existing setting already owns. `exclude` is
 * the setting being renamed, which is allowed to keep its own directory.
 */
export function assertNoRagSettingCollision<T>(
  state: NamedRagSettingsState<T>,
  name: string,
  exclude?: string,
): void {
  const sanitized = sanitizeRagSettingName(name);
  for (const existing of Object.keys(state.ragSettings)) {
    if (existing === exclude) continue;
    if (sanitizeRagSettingName(existing) === sanitized) {
      throw new Error(`RAG setting "${name}" conflicts with existing setting "${existing}" (same directory name)`);
    }
  }
}

/**
 * Move a setting to a new name, following the name everywhere it is referenced:
 * the selection, and any setting built out of this one. The caller moves the
 * index directory; this only touches the state.
 */
export function renameRagSettingInState<T>(
  state: NamedRagSettingsState<T>,
  oldName: string,
  newName: string,
): void {
  state.ragSettings[newName] = state.ragSettings[oldName];
  delete state.ragSettings[oldName];
  for (const setting of withSources(Object.values(state.ragSettings))) {
    if (!setting.sourceRagSettings) continue;
    setting.sourceRagSettings = setting.sourceRagSettings.map(
      (source) => (source === oldName ? newName : source),
    );
  }
  if (state.selectedRagSetting === oldName) state.selectedRagSetting = newName;
}

/**
 * Remove a setting and every reference to it. A setting built out of the
 * removed one keeps working with the sources that remain rather than pointing
 * at a name that no longer resolves.
 */
export function deleteRagSettingFromState<T>(
  state: NamedRagSettingsState<T>,
  name: string,
): void {
  delete state.ragSettings[name];
  for (const setting of withSources(Object.values(state.ragSettings))) {
    if (!setting.sourceRagSettings) continue;
    setting.sourceRagSettings = setting.sourceRagSettings.filter((source) => source !== name);
  }
  if (state.selectedRagSetting === name) state.selectedRagSetting = null;
}

/**
 * Drop sources a setting can no longer use: itself, and names that are gone.
 * Applied on update, so a stale reference cannot survive a round-trip through
 * the settings UI.
 */
export function pruneRagSettingSources<T>(
  state: NamedRagSettingsState<T>,
  name: string,
  setting: T,
): T {
  const [withSourceList] = withSources([setting]);
  const sources = withSourceList.sourceRagSettings;
  if (!sources || sources.length === 0) return setting;
  return {
    ...setting,
    sourceRagSettings: sources.filter((source) => source !== name && !!state.ragSettings[source]),
  };
}
