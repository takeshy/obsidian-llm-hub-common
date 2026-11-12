import { Setting } from "obsidian";
import { normalizeHybridSearchOptions, type HybridSearchOptions } from "../core/hybridSearch.js";
import { t } from "../i18n/index.js";

export function addHybridSearchSettings(
  containerEl: HTMLElement,
  options: Partial<HybridSearchOptions>,
  save: (updates: Partial<HybridSearchOptions>) => Promise<void>,
  refresh: () => void,
): void {
  const current = normalizeHybridSearchOptions(options);
  new Setting(containerEl)
    .setName(t("settings.hybridSearch"))
    .setDesc(t("settings.hybridSearch.desc"))
    .addToggle(toggle => toggle.setValue(current.hybridSearch).onChange(async value => {
      await save({ hybridSearch: value });
      refresh();
    }));
  if (!current.hybridSearch) return;
  new Setting(containerEl)
    .setName(t("settings.hybridCandidateK"))
    .setDesc(t("settings.hybridCandidateK.desc"))
    .addSlider(slider => slider.setLimits(5, 100, 5).setValue(current.hybridCandidateK)
      .onChange(async value => { await save({ hybridCandidateK: value }); }));
}
