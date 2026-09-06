import type { Setting } from "obsidian";
import { cls } from "../core/classPrefix.js";

/**
 * Turn a settings row's control into the full-width, resizable textarea the
 * shared stylesheet styles. The class names live here rather than being spelled
 * out in each host, so the markup and the rules that style it stay together.
 */
export function useSettingTextArea(setting: Setting, inputEl: HTMLTextAreaElement, rows = 4): void {
  setting.settingEl.addClass(cls("settings-textarea-container"));
  inputEl.rows = rows;
  inputEl.addClass(cls("settings-textarea"));
}
