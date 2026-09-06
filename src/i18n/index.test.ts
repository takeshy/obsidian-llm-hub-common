import { beforeEach, describe, expect, it } from "vitest";
import { getLocale, getSupportedLocales, registerTranslations, setLocale, t } from "./index";
import { en } from "./catalogues/en.js";
import { ja } from "./catalogues/ja.js";
import { es } from "./catalogues/es.js";
import { fr } from "./catalogues/fr.js";
import { zh } from "./catalogues/zh.js";
import { ko } from "./catalogues/ko.js";
import { pt } from "./catalogues/pt.js";
import { it as itCatalogue } from "./catalogues/it.js";
import { de } from "./catalogues/de.js";

describe("translation registry", () => {
  beforeEach(() => {
    registerTranslations({
      en: { "chat.send": "Send", "chat.greet": "Hello, {{name}}" },
      ja: { "chat.send": "送信" },
    });
    setLocale("en");
  });

  it("falls back to English, then to the key itself", () => {
    setLocale("ja");
    expect(t("chat.send")).toBe("送信");
    expect(t("chat.greet", { name: "Ada" })).toBe("Hello, Ada");
    expect(t("chat.unknown")).toBe("chat.unknown");
  });

  it("keeps the language part of a full locale and ignores unknown ones", () => {
    setLocale("ja-JP");
    expect(getLocale()).toBe("ja");
    setLocale("fi");
    expect(getLocale()).toBe("en");
  });

  it("lets a later registration override shared wording", () => {
    registerTranslations({ en: { "chat.send": "Ship it" } });
    expect(t("chat.send")).toBe("Ship it");
    expect(getSupportedLocales()).toEqual(expect.arrayContaining(["en", "ja"]));
  });
});

describe("shared catalogues", () => {
  const catalogues = { ja, es, fr, zh, ko, pt, it: itCatalogue, de };
  const enKeys = new Set(Object.keys(en));

  it("translates every key it defines into Japanese", () => {
    // ja is the second first-class locale: a key missing here would silently fall back
    // to English for every Japanese user.
    expect(Object.keys(en).filter(key => !(key in ja))).toEqual([]);
  });

  it("defines no key a translation has but English does not", () => {
    for (const [locale, catalogue] of Object.entries(catalogues)) {
      const orphaned = Object.keys(catalogue).filter(key => !enKeys.has(key));
      expect(orphaned, `${locale} has keys English does not`).toEqual([]);
    }
  });

  it("keeps every placeholder a key's English text uses", () => {
    // "{{variables}}" is documentation shown to the user — placeholder syntax is the
    // subject of those strings, not a value to substitute — so translations reword it.
    const placeholders = (value: string) =>
      (value.match(/\{\{\w+\}\}/g) ?? []).filter(p => p !== "{{variables}}").sort();
    for (const [locale, catalogue] of Object.entries(catalogues)) {
      for (const [key, value] of Object.entries(catalogue)) {
        const expected = placeholders(en[key as keyof typeof en] ?? "");
        expect(placeholders(value), `${locale} "${key}"`).toEqual(expected);
      }
    }
  });
});
