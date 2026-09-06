import { Notice, Setting, type App } from "obsidian";
import { useSettingTextArea } from "./controls.js";
import { formatError } from "../core/error.js";
import { t } from "../i18n/index.js";
import { ConfirmModal } from "../ui/ConfirmModal.js";
import { RagSettingNameModal } from "./RagSettingNameModal.js";

/**
 * Naming and selecting RAG settings is the same in every plugin; what each one
 * then stores under a name is not, so only these operations are shared.
 */
export interface RagSettingManager {
  app: App;
  getRagSettingNames(): string[];
  createRagSetting(name: string): Promise<void>;
  renameRagSetting(name: string, newName: string): Promise<void>;
  deleteRagSetting(name: string): Promise<void>;
  selectRagSetting(name: string | null): Promise<void>;
}

/** The dropdown of saved RAG settings plus the button that adds one. */
export function addRagSettingSelector(
  containerEl: HTMLElement,
  plugin: RagSettingManager,
  selectedName: string | null,
  display: () => void,
): void {
  const setting = new Setting(containerEl)
    .setName(t("settings.ragSetting"))
    .setDesc(t("settings.ragSetting.desc"));

  setting.addDropdown((dropdown) => {
    // Without an explicit "None" the box shows the first setting while nothing
    // is selected, and there is no way to switch RAG off from here again.
    dropdown.addOption("", t("common.none"));
    for (const name of plugin.getRagSettingNames()) dropdown.addOption(name, name);
    dropdown.setValue(selectedName || "").onChange((value) => {
      void (async () => {
        await plugin.selectRagSetting(value || null);
        display();
      })();
    });
  });

  setting.addExtraButton((btn) => {
    btn
      .setIcon("plus")
      .setTooltip(t("settings.createRagSetting"))
      .onClick(() => {
        new RagSettingNameModal(plugin.app, t("settings.createRagSetting"), "", async (name) => {
          try {
            await plugin.createRagSetting(name);
            // A new setting is selected straight away; creating one and then
            // having to pick it is a step nobody wants.
            await plugin.selectRagSetting(name);
            display();
            new Notice(t("settings.ragSettingCreated", { name }));
          } catch (error) {
            new Notice(t("error.failedToCreate", { error: formatError(error) }));
          }
        }).open();
      });
  });
}

/** Work a host has to do before the setting itself goes, such as removing its index. */
export interface RagSettingDeleteHooks {
  beforeDelete?(name: string): Promise<void>;
}

/** The heading for the selected setting, with its rename and delete buttons. */
export function addRagSettingHeader(
  containerEl: HTMLElement,
  plugin: RagSettingManager,
  name: string,
  display: () => void,
  hooks: RagSettingDeleteHooks = {},
): void {
  const setting = new Setting(containerEl)
    .setName(t("settings.settingsFor", { name }))
    .setDesc(t("settings.configureThisSetting"));

  setting.addExtraButton((btn) => {
    btn
      .setIcon("pencil")
      .setTooltip(t("settings.renameSetting"))
      .onClick(() => {
        new RagSettingNameModal(plugin.app, t("settings.renameRagSetting"), name, async (newName) => {
          try {
            await plugin.renameRagSetting(name, newName);
            display();
            new Notice(t("settings.renamedTo", { name: newName }));
          } catch (error) {
            new Notice(t("error.failedToRename", { error: formatError(error) }));
          }
        }).open();
      });
  });

  setting.addExtraButton((btn) => {
    btn
      .setIcon("trash")
      .setTooltip(t("settings.deleteSetting"))
      .onClick(() => {
        void (async () => {
          const confirmed = await new ConfirmModal(
            plugin.app,
            t("settings.deleteSettingConfirm", { name }),
            t("common.delete"),
            t("common.cancel"),
          ).openAndWait();
          if (!confirmed) return;
          try {
            await hooks.beforeDelete?.(name);
            await plugin.deleteRagSetting(name);
            display();
            new Notice(t("settings.ragSettingDeleted", { name }));
          } catch (error) {
            new Notice(t("error.failedToDelete", { error: formatError(error) }));
          }
        })();
      });
  });
}

/** The fields of a RAG setting that decide which files it indexes. */
export interface RagIndexScope {
  targetFolders: string[];
  excludePatterns: string[];
}

/** Comma-separated folders. A folder is one path, so a comma cannot appear in one. */
export function addTargetFoldersSetting(
  containerEl: HTMLElement,
  scope: RagIndexScope,
  save: (updates: Partial<RagIndexScope>) => Promise<void>,
): void {
  new Setting(containerEl)
    .setName(t("settings.targetFolders"))
    .setDesc(t("settings.targetFolders.desc"))
    .addText((text) =>
      text
        .setPlaceholder(t("settings.targetFolders.placeholder"))
        .setValue(scope.targetFolders.join(", "))
        .onChange((value) => {
          void save({ targetFolders: splitList(value, ",") });
        })
    );
}

/**
 * One glob per line, not a comma-separated list: `{tmp,cache}` is brace
 * expansion the matcher understands, and splitting on commas would tear such a
 * pattern in half into two that match nothing.
 */
export function addExcludePatternsSetting(
  containerEl: HTMLElement,
  scope: RagIndexScope,
  save: (updates: Partial<RagIndexScope>) => Promise<void>,
): void {
  const setting = new Setting(containerEl)
    .setName(t("settings.excludedPatterns"))
    .setDesc(t("settings.excludedPatterns.desc"));
  setting.addTextArea((text) => {
    text
      .setPlaceholder(t("settings.excludedPatterns.placeholder"))
      .setValue(scope.excludePatterns.join("\n"))
      .onChange((value) => {
        void save({ excludePatterns: splitList(value, "\n") });
      });
    useSettingTextArea(setting, text.inputEl);
  });
}

function splitList(value: string, separator: string): string[] {
  return value.split(separator).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}
