/**
 * Translation registry shared by the plugins and by the UI in this package.
 *
 * Hosts own their catalogues and register them here, so shared components can call `t()` and get
 * the host's wording without every module taking a translate function as a parameter.
 */
export type TranslationVars = Record<string, string | number>;
export type Catalogue = Record<string, string>;

const catalogues: Record<string, Catalogue> = {};
let currentLocale = "en";

/** Merge catalogues into the registry. Later registrations win, so hosts can override shared text. */
export function registerTranslations(entries: Record<string, Catalogue>): void {
  for (const [locale, catalogue] of Object.entries(entries)) {
    catalogues[locale] = { ...catalogues[locale], ...catalogue };
  }
}

export function getLocale(): string {
  return currentLocale;
}

/** Accepts full locales such as "en-US" or "zh-CN" and keeps the language part. */
export function setLocale(locale: string): void {
  const normalized = locale.split("-")[0].toLowerCase();
  currentLocale = catalogues[normalized] ? normalized : "en";
}

/** Reads the locale Obsidian is running in. Call from the plugin's onload. */
export function initLocale(): void {
  try {
    setLocale(window.moment?.locale?.() || navigator.language || "en");
  } catch {
    setLocale("en");
  }
}

export function getSupportedLocales(): string[] {
  return Object.keys(catalogues);
}

/** Falls back to English, then to the key itself, so a missing string is visible rather than blank. */
export function t(key: string, vars?: TranslationVars): string {
  let result = catalogues[currentLocale]?.[key] ?? catalogues.en?.[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      result = result.replace(new RegExp(`\\{\\{${name}\\}\\}`, "g"), String(value));
    }
  }
  return result;
}

import { en } from "./catalogues/en.js";

/** Keys this package defines. Hosts union it with their own so shared strings stay callable. */
export type SharedTranslationKey = keyof typeof en;
import { ja } from "./catalogues/ja.js";
import { es } from "./catalogues/es.js";
import { fr } from "./catalogues/fr.js";
import { zh } from "./catalogues/zh.js";
import { ko } from "./catalogues/ko.js";
import { pt } from "./catalogues/pt.js";
import { it } from "./catalogues/it.js";
import { de } from "./catalogues/de.js";

// The package's own strings. Hosts register their catalogues afterwards, so their wording wins.
registerTranslations({ en, ja, es, fr, zh, ko, pt, it, de });
