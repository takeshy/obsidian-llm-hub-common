import { Setting, type TextComponent } from "obsidian";
import { clampReadAloudRate, effectiveVoiceSubmitPhrase, MAX_READ_ALOUD_RATE, MIN_READ_ALOUD_RATE } from "../chat/voiceChat.js";
import { DEFAULT_SPEECH_POPUP_COMMAND } from "../chat/speechPopup.js";
import type { VoiceChatSettings } from "../core/voiceChatSettings.js";
import { t } from "../i18n/index.js";
import type { SettingsContext, SettingsPlugin } from "./context.js";

export interface VoiceChatSettingsPlugin extends SettingsPlugin {
  settings: { voiceChat: VoiceChatSettings };
}

/** How long typing has to pause before the value is written. */
const COMMIT_DELAY_MS = 600;

/**
 * Commit a text field without saving every keystroke: saving plugin data touches
 * the Vault and can redraw the pane. Blur alone is not enough, because closing
 * the settings pane removes a focused input without firing blur, which silently
 * threw the typed value away.
 */
function commitWhenSettled(
  plugin: SettingsPlugin,
  text: TextComponent,
  read: () => string,
  write: (value: string) => void,
): void {
  const save = saveAfterPause(plugin);
  const commit = () => {
    const value = text.inputEl.value.trim();
    if (value === read()) return;
    write(value);
    save.now();
  };
  text.onChange(() => {
    const value = text.inputEl.value.trim();
    if (value === read()) return;
    write(value);
    save.later();
  });
  text.inputEl.addEventListener("blur", commit);
}

/** Collapses a burst of changes - typing, or dragging a slider - into one save. */
function saveAfterPause(plugin: SettingsPlugin): { later: () => void; now: () => void } {
  let timer = 0;
  const clear = () => { window.clearTimeout(timer); timer = 0; };
  return {
    later: () => {
      clear();
      timer = window.setTimeout(() => { timer = 0; void plugin.saveSettings(); }, COMMIT_DELAY_MS);
    },
    now: () => {
      clear();
      void plugin.saveSettings();
    },
  };
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

  if (settings.submitOnPaste) {
    new Setting(containerEl)
      .setName(t("settings.voiceSubmitPhrase"))
      .setDesc(t("settings.voiceSubmitPhrase.desc"))
      .addText((text) => {
        text
          .setPlaceholder(effectiveVoiceSubmitPhrase(""))
          .setValue(settings.submitPhrase);
        commitWhenSettled(plugin, text, () => settings.submitPhrase, (value) => { settings.submitPhrase = value; });
      });
  }

  const rateSave = saveAfterPause(plugin);
  new Setting(containerEl)
    .setName(t("settings.readAloudRate"))
    .setDesc(t("settings.readAloudRate.desc"))
    .addSlider((slider) => slider
      .setLimits(MIN_READ_ALOUD_RATE, MAX_READ_ALOUD_RATE, 0.1)
      .setValue(clampReadAloudRate(settings.readAloudRate))
      .setDynamicTooltip()
      .onChange((value) => {
        settings.readAloudRate = clampReadAloudRate(value);
        rateSave.later();
      }));

  // The microphone button appears only when this command answers `status`, so
  // the path matters on hosts where Obsidian's PATH misses the app.
  new Setting(containerEl)
    .setName(t("settings.speechPopupCommand"))
    .setDesc(t("settings.speechPopupCommand.desc"))
    .addText((text) => {
      text
        .setPlaceholder(DEFAULT_SPEECH_POPUP_COMMAND)
        .setValue(settings.speechPopupCommand);
      commitWhenSettled(plugin, text, () => settings.speechPopupCommand, (value) => { settings.speechPopupCommand = value; });
    });
}
