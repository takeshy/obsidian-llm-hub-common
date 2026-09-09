import { describe, expect, it } from "vitest";
import { setLocale } from "../i18n/index.js";
import { buildReadAloudSystemPrompt, clampReadAloudRate, defaultVoiceSubmitPhrase, getReadAloudRate, readAloud, setReadAloudRate, speakingMessageKey, speechKeyForMessage, stopReadingAloud, whenReadingSettles, resolveVoiceSubmitPaste, resolveVoiceSubmitText, speechLanguageForLocale, textForSpeech } from "./voiceChat.js";

describe("voice chat commands", () => {
  it.each([
    ["en", "send it"], ["ja", "送信して"], ["de", "absenden"],
    ["es", "envíalo"], ["fr", "envoie"], ["it", "invia"],
    ["ko", "전송해 줘"], ["pt", "enviar"], ["zh", "发送"],
  ])("provides the localized phrase for %s", (locale, phrase) => {
    setLocale(locale);
    expect(defaultVoiceSubmitPhrase()).toBe(phrase);
  });

  it("consumes a phrase at the end of pasted dictation, including punctuation", () => {
    setLocale("ja");
    expect(resolveVoiceSubmitPaste("前半", " 後半。送信して。", 2, 2)).toEqual({
      text: "前半 後半。",
      phrase: "送信して",
    });
  });

  it("also handles accessibility input and ignores a phrase in the middle", () => {
    setLocale("en");
    expect(resolveVoiceSubmitText("Please SEND IT! ")).toEqual({ text: "Please", phrase: "send it" });
    expect(resolveVoiceSubmitText("Explain what send it means")).toBeNull();
    expect(resolveVoiceSubmitText("Please resend it")).toBeNull();
  });

  it("uses the customized phrase", () => {
    expect(resolveVoiceSubmitText("本文 お願い", "お願い")).toEqual({ text: "本文", phrase: "お願い" });
  });

  it("maps the Obsidian display locale to a speech synthesis language", () => {
    expect(speechLanguageForLocale("en")).toBe("en-US");
    expect(speechLanguageForLocale("ja")).toBe("ja-JP");
  });

  it("removes code, links, images, URLs and Markdown punctuation before speech", () => {
    expect(textForSpeech("# Hello **world** [site](https://example.com) ![x](a.png)\n```ts\nconst x = 1\n```"))
      .toBe("Hello world site");
  });
});

describe("buildReadAloudSystemPrompt", () => {
  it("asks for a short spoken answer without markup", () => {
    const prompt = buildReadAloudSystemPrompt();
    expect(prompt.startsWith("\n\n")).toBe(true);
    expect(prompt).toContain("spoken by a speech synthesizer");
    expect(prompt).toContain("few short sentences");
    expect(prompt).toContain("no headings, bullet lists, tables, code blocks, URLs, or file paths");
    expect(prompt).toContain("user's language");
  });
});

describe("read aloud state", () => {
  interface FakeUtterance { text: string; lang: string; rate: number; onend: (() => void) | null; onerror: (() => void) | null }

  function installSpeechSynthesis(): FakeUtterance[] {
    const spoken: FakeUtterance[] = [];
    const target = globalThis as unknown as Record<string, unknown>;
    target.SpeechSynthesisUtterance = class {
      lang = "";
      rate = 1;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public text: string) {}
    };
    target.window = { speechSynthesis: { cancel: () => {}, speak: (utterance: FakeUtterance) => spoken.push(utterance) } };
    return spoken;
  }

  it("reports the message being spoken and clears it when stopped", () => {
    installSpeechSynthesis();
    const key = speechKeyForMessage({ timestamp: 7 });
    expect(readAloud("Hello there", "en-US", key)).toBe(true);
    expect(speakingMessageKey()).toBe(key);
    stopReadingAloud();
    expect(speakingMessageKey()).toBeNull();
  });

  it("settles once the reading ends, and after a grace period if none starts", async () => {
    const spoken = installSpeechSynthesis();
    readAloud("a long answer", "en-US", "message:1");
    let settled = false;
    const waiting = whenReadingSettles(5).then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Still speaking: the grace period must not release the caller.
    expect(settled).toBe(false);
    spoken[0].onend?.();
    await waiting;
    expect(settled).toBe(true);

    // Nothing speaks at all (no engine, or an answer with no speakable text).
    stopReadingAloud();
    await whenReadingSettles(5);
  });

  it("reads at the configured rate, clamped to what a voice can do", () => {
    const spoken = installSpeechSynthesis();
    setReadAloudRate(1.6);
    readAloud("faster please", "en-US", "message:1");
    expect(spoken[0].rate).toBe(1.6);

    // A stored value from outside the slider's range must not silence the voice.
    setReadAloudRate(99);
    expect(getReadAloudRate()).toBe(3);
    setReadAloudRate(Number.NaN);
    expect(getReadAloudRate()).toBe(1);
    expect(clampReadAloudRate(0.1)).toBe(0.5);
    stopReadingAloud();
  });

  it("lets only the newest utterance clear the state", () => {
    const spoken = installSpeechSynthesis();
    readAloud("first", "en-US", "message:1");
    readAloud("second", "en-US", "message:2");
    // The cancelled first utterance still reports its end afterwards.
    spoken[0].onend?.();
    expect(speakingMessageKey()).toBe("message:2");
    spoken[1].onend?.();
    expect(speakingMessageKey()).toBeNull();
  });
});
