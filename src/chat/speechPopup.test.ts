import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "../i18n/index.js";
import { resolveConversationPaste, resolveConversationText } from "./voiceChat.js";
import {
  configureSpeechPopupRunner,
  effectiveSpeechPopupCommand,
  parseSpeechPopupStatus,
  showSpeechPopup,
  speechPopupStatus,
} from "./speechPopup.js";

const RUNNING = [
  "speech-popup 1.4.0",
  "daemon:   running",
  "endpoint: /run/user/1000/speech-popup.sock",
  "config:   /home/user/.config/speech-popup/config.toml",
].join("\n");

const STOPPED = RUNNING.replace("daemon:   running", "daemon:   not running");

describe("speech-popup status", () => {
  afterEach(() => { configureSpeechPopupRunner(null); });

  it("reads installation from the banner and the daemon separately", () => {
    expect(parseSpeechPopupStatus(RUNNING)).toEqual({ installed: true, daemonRunning: true, version: "1.4.0" });
    expect(parseSpeechPopupStatus(STOPPED)).toEqual({ installed: true, daemonRunning: false, version: "1.4.0" });
    // A missing binary prints nothing on stdout.
    expect(parseSpeechPopupStatus("")).toEqual({ installed: false, daemonRunning: false, version: "" });
  });

  it("keeps a custom command, unquotes a pasted path and falls back to PATH", () => {
    expect(effectiveSpeechPopupCommand(" /opt/speech-popup ")).toBe("/opt/speech-popup");
    // Windows Explorer's "Copy as path" quotes it, and backslashes must survive.
    expect(effectiveSpeechPopupCommand('"C:\\Users\\takes\\programs\\speech-popup.exe"'))
      .toBe("C:\\Users\\takes\\programs\\speech-popup.exe");
    expect(effectiveSpeechPopupCommand('"C:\\Program Files\\speech popup\\speech-popup.exe"'))
      .toBe("C:\\Program Files\\speech popup\\speech-popup.exe");
    // Unquoted, a path with spaces is still one file name.
    expect(effectiveSpeechPopupCommand(" C:\\Program Files\\speech-popup.exe "))
      .toBe("C:\\Program Files\\speech-popup.exe");
    expect(effectiveSpeechPopupCommand("")).toBe("speech-popup");
  });

  it("asks the configured command for its status and shows the window", async () => {
    const calls: { command: string; args: readonly string[] }[] = [];
    configureSpeechPopupRunner((command, args) => {
      calls.push({ command, args });
      return Promise.resolve({ ok: args[0] === "show", stdout: args[0] === "status" ? STOPPED : "", stderr: "" });
    });
    expect(await speechPopupStatus("/opt/speech-popup")).toMatchObject({ installed: true, daemonRunning: false });
    expect(await showSpeechPopup("/opt/speech-popup")).toMatchObject({ ok: true });
    expect(calls).toEqual([
      { command: "/opt/speech-popup", args: ["status"] },
      { command: "/opt/speech-popup", args: ["show"] },
    ]);
  });

  it("treats a failed command as not installed and says which command failed", async () => {
    configureSpeechPopupRunner(() => Promise.resolve({ ok: false, stdout: "", stderr: "", error: "spawn ENOENT" }));
    expect(await speechPopupStatus("/opt/missing")).toEqual({
      installed: false, daemonRunning: false, version: "",
      error: "/opt/missing status: spawn ENOENT",
    });
    const shown = await showSpeechPopup("/opt/missing");
    expect(shown.ok).toBe(false);
    expect(shown.error).toBe("/opt/missing show: spawn ENOENT");
  });
});

describe("voice conversation turns", () => {
  it("sends what was dictated and ends when only the phrase is spoken", () => {
    setLocale("ja");
    // speech-popup drops its own send phrase, so plain dictation is the answer.
    expect(resolveConversationPaste("前半 ", "これが答え", 3, 3)).toEqual({ end: false, text: "前半 これが答え" });
    // The plugin's phrase still applies, and alone it closes the session.
    expect(resolveConversationPaste("", "本題です。送信して", 0, 0)).toEqual({ end: false, text: "本題です。" });
    expect(resolveConversationPaste("", "送信して", 0, 0)).toEqual({ end: true, text: "" });
    expect(resolveConversationPaste("leftover", "   ", 8, 8)).toBeNull();
  });

  it("recognizes the same ending from typed or accessibility input", () => {
    setLocale("en");
    expect(resolveConversationText(" send it ")).toEqual({ end: true, text: "" });
    expect(resolveConversationText("one more thing")).toEqual({ end: false, text: "one more thing" });
    expect(resolveConversationText("   ")).toBeNull();
    expect(resolveConversationText("お願い", "お願い")).toEqual({ end: true, text: "" });
  });
});
