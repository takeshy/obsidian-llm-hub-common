import { useEffect, useRef, useSyncExternalStore } from "react";
import { getLocale, t } from "../i18n/index.js";

// Re-exported so hosts can keep taking the voice settings from this module.
export { DEFAULT_VOICE_CHAT_SETTINGS, type VoiceChatSettings } from "../core/voiceChatSettings.js";

export function defaultVoiceSubmitPhrase(): string {
  return t("voice.submitPhrase");
}

export function effectiveVoiceSubmitPhrase(customPhrase: string): string {
  return customPhrase.trim() || defaultVoiceSubmitPhrase();
}

export interface VoiceSubmitPasteResult {
  text: string;
  phrase: string;
}

const TRAILING_PUNCTUATION = new Set([".", "!", "?", "。", "！", "？", ",", "，", "、"]);

function trimTrailingPunctuation(text: string): string {
  let end = text.length;
  while (end > 0) {
    const char = text[end - 1];
    if (!/\s/u.test(char) && !TRAILING_PUNCTUATION.has(char)) break;
    end--;
  }
  return text.slice(0, end);
}

/**
 * Apply a paste at the current selection and consume a translated command at
 * the very end. Matching at the end avoids sending ordinary text that merely
 * mentions the phrase. Latin-script matching is case-insensitive.
 */
export function resolveVoiceSubmitPaste(
  value: string,
  pastedText: string,
  selectionStart: number,
  selectionEnd: number,
  customPhrase = "",
): VoiceSubmitPasteResult | null {
  const combined = value.slice(0, selectionStart) + pastedText + value.slice(selectionEnd);
  return resolveVoiceSubmitText(combined, customPhrase);
}

/** Detect the same command after accessibility-based dictation or ordinary input. */
export function resolveVoiceSubmitText(value: string, customPhrase = ""): VoiceSubmitPasteResult | null {
  const phrase = effectiveVoiceSubmitPhrase(customPhrase);
  if (!phrase) return null;

  const combined = value;
  const withoutPunctuation = trimTrailingPunctuation(combined);
  const phraseStart = withoutPunctuation.length - phrase.length;
  if (phraseStart < 0
    || !withoutPunctuation.toLocaleLowerCase(getLocale()).endsWith(phrase.toLocaleLowerCase(getLocale()))) {
    return null;
  }
  // Do not treat the English phrase in "resend it" (or an equivalent Latin
  // word suffix) as a command. Scripts without word separators are unaffected.
  if (/^[A-Za-z0-9]/.test(phrase) && phraseStart > 0
    && /[A-Za-z0-9]/.test(withoutPunctuation[phraseStart - 1])) return null;

  return {
    text: withoutPunctuation.slice(0, -phrase.length).trim(),
    phrase,
  };
}

/** Remove Markdown constructs that speech engines otherwise read as punctuation. */
export function textForSpeech(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+] |\d+[.)] )/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Spoken answers need a different shape than read ones: markup and long
 * transcripts are either dropped by textForSpeech or read out as punctuation.
 */
export function buildReadAloudSystemPrompt(): string {
  return [
    "\n\nAutomatic read-aloud is on: this answer is spoken by a speech synthesizer instead of being read on screen.",
    "Answer in a few short sentences and lead with the answer itself, without preamble, restating the question, or closing offers.",
    "Write speakable prose in the user's language: no headings, bullet lists, tables, code blocks, URLs, or file paths, because those are dropped or read out as punctuation.",
    "When something can only be shown in writing, such as code or a long list, say briefly what it is and keep the written part as short as the request allows.",
    "If the answer genuinely needs to be long, say the summary first and ask whether to continue.",
  ].join(" ");
}

// Which message is being spoken, so its own bubble can offer to stop it.
let speakingKey: string | null = null;
let utteranceSequence = 0;
const speakingListeners = new Set<() => void>();

function setSpeakingKey(key: string | null): void {
  if (speakingKey === key) return;
  speakingKey = key;
  for (const listener of [...speakingListeners]) listener();
}

function subscribeSpeaking(listener: () => void): () => void {
  speakingListeners.add(listener);
  return () => { speakingListeners.delete(listener); };
}

export function speakingMessageKey(): string | null {
  return speakingKey;
}

/** Key a message by its timestamp so every reader of the same message agrees. */
export function speechKeyForMessage(message: { timestamp?: number }): string {
  return `message:${message.timestamp ?? 0}`;
}

export function useSpeakingMessageKey(): string | null {
  return useSyncExternalStore(subscribeSpeaking, speakingMessageKey, speakingMessageKey);
}

export function stopReadingAloud(): void {
  utteranceSequence++;
  setSpeakingKey(null);
  window.speechSynthesis?.cancel();
}

const SPEECH_LANGUAGE_BY_LOCALE: Record<string, string> = {
  de: "de-DE",
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  it: "it-IT",
  ja: "ja-JP",
  ko: "ko-KR",
  pt: "pt-BR",
  zh: "zh-CN",
};

export function speechLanguageForLocale(locale = getLocale()): string {
  return SPEECH_LANGUAGE_BY_LOCALE[locale.split("-")[0].toLowerCase()] ?? locale;
}

export function readAloud(text: string, lang = speechLanguageForLocale(), key: string | null = null): boolean {
  const spoken = textForSpeech(text);
  if (!spoken || !window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(spoken);
  utterance.lang = lang;
  // A cancelled utterance still reports end or error afterwards, so only the
  // newest one may clear the speaking state.
  const sequence = ++utteranceSequence;
  const finish = () => { if (sequence === utteranceSequence) setSpeakingKey(null); };
  utterance.onend = finish;
  utterance.onerror = finish;
  setSpeakingKey(key);
  window.speechSynthesis.speak(utterance);
  return true;
}

/** Read only newly completed assistant turns, never a conversation loaded from history. */
export function useAutoReadAloud<M extends { role: string; content: string; timestamp?: number }>(messages: readonly M[], isLoading: boolean, enabled: boolean): void {
  const previousLoading = useRef(isLoading);
  const previousEnabled = useRef(enabled);
  useEffect(() => {
    const completed = previousLoading.current && !isLoading;
    const disabledNow = previousEnabled.current && !enabled;
    previousLoading.current = isLoading;
    previousEnabled.current = enabled;
    if (!enabled) {
      if (disabledNow) stopReadingAloud();
      return;
    }
    if (!completed) return;
    const last = messages[messages.length - 1];
    if (last?.role === "assistant") readAloud(last.content, undefined, speechKeyForMessage(last));
  }, [enabled, isLoading, messages]);
}
