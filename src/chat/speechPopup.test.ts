import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "../i18n/index.js";
import { resolveConversationPaste, VOICE_CHAT_MARKER } from "./voiceChat.js";
import {
  configureSpeechPopupRunner,
  hostSpawnCommand,
  sandboxHint,
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
      // Every show asks the popup to mark what it pastes.
      { command: "/opt/speech-popup", args: ["show", "--append", VOICE_CHAT_MARKER] },
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
  it("reads what the popup marked, and leaves other pastes alone", () => {
    setLocale("ja");
    const marked = (text: string) => `${text} ${VOICE_CHAT_MARKER}`;
    // The marker says this paste came from a popup this chat opened.
    expect(resolveConversationPaste("前半 ", marked("これが答え"), 3, 3))
      .toEqual({ end: false, text: "前半 これが答え" });
    // Nothing dictated: the popup was closed on an empty transcript.
    expect(resolveConversationPaste("", VOICE_CHAT_MARKER, 0, 0)).toEqual({ end: true, text: "" });
    // Words the user merely spoke are not the marker, whatever they are.
    expect(resolveConversationPaste("", "送信して", 0, 0)).toBeNull();
    expect(resolveConversationPaste("", "貼り付けたいだけ", 0, 0)).toBeNull();
  });
});

describe("marking what the popup pastes", () => {
  afterEach(() => { configureSpeechPopupRunner(null); });

  it("asks the popup to mark what it pastes", async () => {
    const calls: string[][] = [];
    configureSpeechPopupRunner((_command, args) => {
      calls.push([...args]);
      return Promise.resolve({ ok: true, stdout: "", stderr: "" });
    });
    expect(await showSpeechPopup()).toMatchObject({ ok: true });
    expect(calls).toEqual([["show", "--append", VOICE_CHAT_MARKER]]);
  });

  it("reports a popup that will not take the marker", async () => {
    configureSpeechPopupRunner(() => Promise.resolve({
      ok: false, stdout: "", stderr: `invalid command "show {\"append\":\"⟦voice-chat⟧\"}"`,
    }));
    const result = await showSpeechPopup();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("invalid command");
  });
});

describe("reaching the host from a sandboxed Obsidian", () => {
  it("goes through the Flatpak portal, and leaves an unsandboxed command alone", () => {
    // The sandbox cannot see programs installed on the host; Flatpak lends a
    // portal for exactly this, and other Obsidian plugins reach their binaries
    // the same way.
    expect(hostSpawnCommand("/opt/speech-popup", ["show", "--append", "x"], "flatpak"))
      .toEqual({ file: "flatpak-spawn", args: ["--host", "/opt/speech-popup", "show", "--append", "x"] });
    expect(hostSpawnCommand("speech-popup", ["status"], "none"))
      .toEqual({ file: "speech-popup", args: ["status"] });
    // Snap has no such portal, so the command is left to fail with an explanation.
    expect(hostSpawnCommand("speech-popup", ["status"], "snap"))
      .toEqual({ file: "speech-popup", args: ["status"] });
  });

  it("says what to do about each sandbox", () => {
    expect(sandboxHint("flatpak")).toContain("flatpak override --user --talk-name=org.freedesktop.Flatpak");
    expect(sandboxHint("snap")).toContain("cannot start programs installed on the host");
    expect(sandboxHint("none")).toBeUndefined();
  });
});
