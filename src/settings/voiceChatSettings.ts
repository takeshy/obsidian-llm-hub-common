import { Setting } from "obsidian";
import { effectiveVoiceSubmitPhrase } from "../chat/voiceChat.js";
import type { VoiceChatSettings } from "../core/voiceChatSettings.js";
import { t } from "../i18n/index.js";
import type { SettingsContext, SettingsPlugin } from "./context.js";

export interface VoiceChatSettingsPlugin extends SettingsPlugin {
  settings: { voiceChat: VoiceChatSettings };
}

/** Settings for app-independent dictation paste handling. */
export function addVoiceSubmitSettings(
  containerEl: HTMLElement,
  ctx: SettingsContext<VoiceChatSettingsPlugin>,
): void {
  const { plugin, display } = ctx;
  const settings = plugin.settings.voiceChat;

  new Setting(containerEl)
    .setName(t("settings.voiceSubmit"))
    .setDesc(t("settings.voiceSubmit.desc"))
    .addToggle((toggle) => toggle.setValue(settings.submitOnPaste).onChange((value) => {
      void (async () => {
        settings.submitOnPaste = value;
        await plugin.saveSettings();
        display();
      })();
    }));

  if (!settings.submitOnPaste) return;

  new Setting(containerEl)
    .setName(t("settings.voiceSubmitPhrase"))
    .setDesc(t("settings.voiceSubmitPhrase.desc"))
    .addText((text) => {
      text
        .setPlaceholder(effectiveVoiceSubmitPhrase(""))
        .setValue(settings.submitPhrase);
      // Saving plugin data can redraw settings and touch the Vault. Commit the
      // completed phrase once instead of doing that for every dictated letter.
      text.inputEl.addEventListener("blur", () => {
        const value = text.inputEl.value.trim();
        if (value === settings.submitPhrase) return;
        settings.submitPhrase = value;
        text.setValue(value);
        void plugin.saveSettings();
      });
    });
}
