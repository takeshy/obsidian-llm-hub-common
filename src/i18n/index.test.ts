import { beforeEach, describe, expect, it } from "vitest";
import { getLocale, getSupportedLocales, registerTranslations, setLocale, t } from "./index";

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
