import { Notice, Setting, type App } from "obsidian";
import { cls } from "../core/classPrefix.js";
import { normalizeVaultScopePath } from "../core/vaultScope.js";
import { t } from "../i18n/index.js";
import { ConfirmModal } from "../ui/ConfirmModal.js";
import type { SettingsContext, SettingsPlugin } from "./context.js";

/**
 * What a folder typed into a settings row resolves to, or null when it is empty
 * or the scope rule refuses it. Slashes around the name are cosmetic and
 * stripped; everything else goes through the same rule the Vault tool scope
 * applies, so an absolute path, a drive letter, a backslash and a ".."
 * segment are all refused. A substring test for ".." — what these rows used to
 * do — would also refuse a real folder named "a..b".
 */
export function normalizeFolderInput(typed: string): string | null {
  const stripped = typed.trim().replace(/^\/+|\/+$/g, "");
  return stripped ? normalizeVaultScopePath(stripped) : null;
}

/** What the workspace folder row reads and writes. */
export interface WorkspaceFolderPlugin extends SettingsPlugin {
  settings: { workspaceFolder: string; hideWorkspaceFolder: boolean };
  /** Shows or hides the folder in the file explorer, per the toggle below the row. */
  updateWorkspaceFolderVisibility(): void;
  /** Re-reads chats, RAG settings and the rest of the state kept in the folder. */
  loadWorkspaceState(): Promise<void>;
}

/**
 * What a host has to carry across when the workspace folder moves. Anything
 * keyed by the folder name — a stored credential, a cached index — lives
 * outside the folder itself, so the move cannot see it.
 */
export interface WorkspaceFolderMoveHooks {
  /**
   * Runs after the user confirms the move and before the rename. Return
   * `{ error }` to abort with that message shown, or a `rollback` the failed
   * rename will call. Hosts with nothing keyed by the folder omit this.
   */
  beforeRename?(from: string, to: string): { error: string } | { rollback?: () => void };
  /** Runs once the new folder is saved and the workspace state reloaded. */
  afterMove?(from: string, to: string): void;
  /** Runs whenever the folder changed, whether or not anything was moved. */
  afterChange?(folder: string): void;
}

export function addWorkspaceFolderSetting(
  containerEl: HTMLElement,
  ctx: SettingsContext<WorkspaceFolderPlugin>,
  defaultFolder: string,
  hooks: WorkspaceFolderMoveHooks = {},
): void {
  const { plugin, display } = ctx;
  const app = plugin.app;

  new Setting(containerEl)
    .setName(t("settings.workspaceFolder"))
    .setDesc(t("settings.workspaceFolder.desc"))
    .addText((text) => {
      text
        .setPlaceholder(defaultFolder)
        .setValue(plugin.settings.workspaceFolder);
      // Committed on blur rather than per keystroke: half-typed names would
      // otherwise rename the folder on the way to the one the user wanted.
      text.inputEl.addEventListener("blur", () => {
        void (async () => {
          const oldFolder = plugin.settings.workspaceFolder || defaultFolder;
          // An empty box means "back to the default", not "invalid".
          const newFolder = text.inputEl.value.trim()
            ? normalizeFolderInput(text.inputEl.value)
            : defaultFolder;

          if (!newFolder) {
            new Notice(t("settings.workspaceFolder.invalidPath"));
            text.setValue(oldFolder);
            return;
          }
          text.setValue(newFolder);
          if (newFolder === oldFolder) return;

          if (await app.vault.adapter.exists(oldFolder)) {
            const confirmed = await new ConfirmModal(
              app,
              t("settings.moveWorkspaceFolder", { from: oldFolder, to: newFolder }),
              t("settings.moveWorkspaceFolder.move"),
              t("settings.moveWorkspaceFolder.skip"),
            ).openAndWait();

            if (confirmed) {
              const prepared = hooks.beforeRename?.(oldFolder, newFolder) ?? {};
              if ("error" in prepared) {
                new Notice(t("settings.moveWorkspaceFolder.error", { error: prepared.error }));
                text.setValue(oldFolder);
                return;
              }
              try {
                await app.vault.adapter.rename(oldFolder, newFolder);
              } catch (error) {
                prepared.rollback?.();
                new Notice(t("settings.moveWorkspaceFolder.error", { error: String(error) }));
                text.setValue(oldFolder);
                return;
              }
              plugin.settings.workspaceFolder = newFolder;
              await plugin.saveSettings();
              plugin.updateWorkspaceFolderVisibility();
              await plugin.loadWorkspaceState();
              hooks.afterMove?.(oldFolder, newFolder);
              hooks.afterChange?.(newFolder);
              display();
              return;
            }
          }

          plugin.settings.workspaceFolder = newFolder;
          await plugin.saveSettings();
          plugin.updateWorkspaceFolderVisibility();
          await plugin.loadWorkspaceState();
          hooks.afterChange?.(newFolder);
          display();
        })();
      });
    });
}

/**
 * The toggle that hides the workspace folder from the file explorer. Shown only
 * while the folder still has its default name: a folder the user named
 * themselves is one they meant to see.
 */
export function addHideWorkspaceFolderSetting(
  containerEl: HTMLElement,
  ctx: SettingsContext<WorkspaceFolderPlugin>,
  defaultFolder: string,
): void {
  const { plugin } = ctx;
  if ((plugin.settings.workspaceFolder || defaultFolder) !== defaultFolder) return;

  new Setting(containerEl)
    .setName(t("settings.hideWorkspaceFolder"))
    .setDesc(t("settings.hideWorkspaceFolder.desc"))
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.settings.hideWorkspaceFolder)
        .onChange((value) => {
          void (async () => {
            plugin.settings.hideWorkspaceFolder = value;
            await plugin.saveSettings();
            plugin.updateWorkspaceFolderVisibility();
          })();
        })
    );
}

/**
 * The folder allow-list for built-in Vault tools. Names are validated with the
 * same rule the scope check applies, because a folder it cannot normalize
 * denies every path: storing one silently would look like the Vault tools had
 * stopped working rather than like a typo.
 */
export function addAllowedVaultFoldersSetting(
  containerEl: HTMLElement,
  ctx: SettingsContext<SettingsPlugin>,
  labels: { name: string; desc: string; placeholder: string },
  folders: { get(): string[]; set(folders: string[]): void },
): void {
  const { plugin } = ctx;

  new Setting(containerEl)
    .setName(labels.name)
    .setDesc(labels.desc)
    .addText((text) => {
      text.setPlaceholder(labels.placeholder).setValue(folders.get().join(", "));
      text.inputEl.addEventListener("blur", () => {
        void (async () => {
          const normalized = text.inputEl.value
            .split(",")
            .filter((folder) => folder.trim())
            .map(normalizeFolderInput);

          if (normalized.some((folder) => folder === null)) {
            new Notice(t("settings.vaultToolAllowedFolders.invalidPath"));
            text.setValue(folders.get().join(", "));
            return;
          }
          folders.set(normalized.filter((folder): folder is string => folder !== null));
          text.setValue(folders.get().join(", "));
          await plugin.saveSettings();
        })();
      });
    });
}

/** What the chat history rows read and write. */
export interface ChatHistorySettingsPlugin extends SettingsPlugin {
  settings: { saveChatHistory: boolean; maxSavedChatHistories: number };
}

/**
 * `chatHistoryFolder` is the folder the chat store actually writes to, not the
 * workspace folder: hosts differ on whether chats sit in it or in a subfolder,
 * and clearing the wrong one silently deletes nothing.
 */
export function addSaveChatHistorySetting(
  containerEl: HTMLElement,
  ctx: SettingsContext<ChatHistorySettingsPlugin>,
  chatHistoryFolder: () => string,
): void {
  const { plugin } = ctx;

  new Setting(containerEl)
    .setName(t("settings.saveChatHistory"))
    .setDesc(t("settings.saveChatHistory.desc"))
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.settings.saveChatHistory)
        .onChange((value) => {
          void (async () => {
            // Turning the setting off offers to remove what was already saved;
            // leaving the files behind is a reasonable answer too, so it asks.
            if (!value) {
              const confirmed = await new ConfirmModal(
                plugin.app,
                t("settings.deleteChatHistoryConfirm"),
                t("common.delete"),
                t("common.cancel"),
              ).openAndWait();
              if (confirmed) await deleteChatHistoryFiles(plugin.app, chatHistoryFolder());
            }
            plugin.settings.saveChatHistory = value;
            await plugin.saveSettings();
          })();
        })
    );
}

/**
 * Remove the saved chat files from a folder, leaving everything else in it.
 * Only files the chat store named are touched — the folder also holds workspace
 * state and whatever else the host keeps beside it.
 */
export async function deleteChatHistoryFiles(app: App, folder: string): Promise<void> {
  if (!(await app.vault.adapter.exists(folder))) return;

  const listed = await app.vault.adapter.list(folder);
  const chatFiles = listed.files.filter((path) => {
    const name = path.split("/").pop() || "";
    return name.startsWith("chat_") && (name.endsWith(".md") || name.endsWith(".md.encrypted"));
  });

  let deletedCount = 0;
  for (const file of chatFiles) {
    try {
      await app.vault.adapter.remove(file);
      deletedCount++;
    } catch {
      // One unreadable file should not stop the rest.
    }
  }

  if (deletedCount > 0) {
    new Notice(t("settings.chatHistoryDeleted", { count: String(deletedCount) }));
  }
}

export function addMaxSavedChatHistoriesSetting(
  containerEl: HTMLElement,
  ctx: SettingsContext<ChatHistorySettingsPlugin>,
  defaultValue: number,
): void {
  const { plugin } = ctx;

  new Setting(containerEl)
    .setName(t("settings.maxSavedChatHistories"))
    .setDesc(t("settings.maxSavedChatHistories.desc"))
    .addText((text) => {
      text
        .setPlaceholder(String(defaultValue))
        .setValue(String(plugin.settings.maxSavedChatHistories));
      text.inputEl.type = "number";
      text.inputEl.min = "0";
      text.inputEl.step = "1";
      text.inputEl.addEventListener("blur", () => {
        const parsed = Number.parseInt(text.inputEl.value, 10);
        const value = Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultValue;
        plugin.settings.maxSavedChatHistories = value;
        text.inputEl.value = String(value);
        void plugin.saveSettings();
      });
    });
}

/** What the system prompt row reads and writes. */
export interface SystemPromptSettingsPlugin extends SettingsPlugin {
  settings: { systemPrompt: string };
}

export function addSystemPromptSetting(
  containerEl: HTMLElement,
  ctx: SettingsContext<SystemPromptSettingsPlugin>,
  rows = 4,
): void {
  const { plugin } = ctx;

  const setting = new Setting(containerEl)
    .setName(t("settings.systemPrompt"))
    .setDesc(t("settings.systemPrompt.desc"));
  setting.settingEl.addClass(cls("settings-textarea-container"));
  setting.addTextArea((text) => {
    text
      .setPlaceholder(t("settings.systemPrompt.placeholder"))
      .setValue(plugin.settings.systemPrompt)
      .onChange((value) => {
        void (async () => {
          plugin.settings.systemPrompt = value;
          await plugin.saveSettings();
        })();
      });
    text.inputEl.rows = rows;
    text.inputEl.addClass(cls("settings-textarea"));
  });
}

/** The numbers the tool-limit sliders read and write. */
export interface ToolLimitSettings {
  maxFunctionCalls: number;
  functionCallWarningThreshold: number;
  listNotesLimit: number;
  maxNoteChars: number;
}

export interface ToolLimitsPlugin extends SettingsPlugin {
  settings: ToolLimitSettings;
}

/**
 * The collapsible tool-limits section. The warning threshold is kept at or
 * below the call limit from both directions, so the pair can never describe a
 * warning that could not fire.
 */
export function addToolLimitsSection(
  containerEl: HTMLElement,
  ctx: SettingsContext<ToolLimitsPlugin>,
  defaults: ToolLimitSettings,
): void {
  const { plugin, display } = ctx;
  const save = async () => plugin.saveSettings();

  const detailsEl = containerEl.createEl("details", { cls: cls("settings-details") });
  detailsEl.createEl("summary", { text: t("settings.toolLimits"), cls: cls("settings-summary") });

  new Setting(detailsEl)
    .setName(t("settings.maxToolCalls"))
    .setDesc(t("settings.maxToolCalls.desc"))
    .addSlider((slider) =>
      slider
        .setLimits(1, 50, 1)
        .setValue(plugin.settings.maxFunctionCalls)
        .onChange((value) => {
          void (async () => {
            plugin.settings.maxFunctionCalls = value;
            const clampedWarning = plugin.settings.functionCallWarningThreshold > value;
            if (clampedWarning) plugin.settings.functionCallWarningThreshold = value;
            await save();
            if (clampedWarning) display();
          })();
        })
    )
    .addExtraButton((button) =>
      button
        .setIcon("reset")
        .setTooltip(t("settings.resetToDefault", { value: String(defaults.maxFunctionCalls) }))
        .onClick(() => {
          void (async () => {
            plugin.settings.maxFunctionCalls = defaults.maxFunctionCalls;
            if (plugin.settings.functionCallWarningThreshold > defaults.maxFunctionCalls) {
              plugin.settings.functionCallWarningThreshold = defaults.maxFunctionCalls;
            }
            await save();
            display();
          })();
        })
    );

  new Setting(detailsEl)
    .setName(t("settings.toolCallWarning"))
    .setDesc(t("settings.toolCallWarning.desc"))
    .addSlider((slider) =>
      slider
        .setLimits(1, 50, 1)
        .setValue(plugin.settings.functionCallWarningThreshold)
        .onChange((value) => {
          void (async () => {
            const nextValue = Math.min(value, plugin.settings.maxFunctionCalls);
            plugin.settings.functionCallWarningThreshold = nextValue;
            await save();
            if (nextValue !== value) display();
          })();
        })
    )
    .addExtraButton((button) =>
      button
        .setIcon("reset")
        .setTooltip(t("settings.resetToDefault", { value: String(defaults.functionCallWarningThreshold) }))
        .onClick(() => {
          void (async () => {
            plugin.settings.functionCallWarningThreshold = defaults.functionCallWarningThreshold;
            await save();
            display();
          })();
        })
    );

  addSliderSetting(detailsEl, ctx, {
    name: t("settings.listNotesLimit"),
    desc: t("settings.listNotesLimit.desc"),
    limits: [10, 200, 10],
    key: "listNotesLimit",
    defaultValue: defaults.listNotesLimit,
  });

  addSliderSetting(detailsEl, ctx, {
    name: t("settings.maxNoteChars"),
    desc: t("settings.maxNoteChars.desc"),
    limits: [1000, 100000, 1000],
    key: "maxNoteChars",
    defaultValue: defaults.maxNoteChars,
  });
}

function addSliderSetting(
  containerEl: HTMLElement,
  ctx: SettingsContext<ToolLimitsPlugin>,
  options: {
    name: string;
    desc: string;
    limits: [number, number, number];
    key: "listNotesLimit" | "maxNoteChars";
    defaultValue: number;
  },
): void {
  const { plugin, display } = ctx;

  new Setting(containerEl)
    .setName(options.name)
    .setDesc(options.desc)
    .addSlider((slider) =>
      slider
        .setLimits(...options.limits)
        .setValue(plugin.settings[options.key])
        .onChange((value) => {
          void (async () => {
            plugin.settings[options.key] = value;
            await plugin.saveSettings();
          })();
        })
    )
    .addExtraButton((button) =>
      button
        .setIcon("reset")
        .setTooltip(t("settings.resetToDefault", { value: String(options.defaultValue) }))
        .onClick(() => {
          void (async () => {
            plugin.settings[options.key] = options.defaultValue;
            await plugin.saveSettings();
            display();
          })();
        })
    );
}
