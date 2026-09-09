/**
 * Pseudo-conversation with the external speech-popup app (a resident dictation
 * window that pastes its transcript into whatever had focus).
 *
 * The plugin never receives the transcript directly: speech-popup pastes it, so
 * a paste while a session is active is the answer, and an empty paste is the
 * user leaving. Reopening the popup the moment a turn lands is what lets someone
 * speak again while the reply is still being read aloud.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getNodeModule } from "../core/nodeModule.js";
import { splitCommandLine } from "../mcp/commandLine.js";
import { formatError } from "../core/error.js";
import { t } from "../i18n/index.js";
import { stopReadingAloud, VOICE_CHAT_MARKER, whenReadingSettles } from "./voiceChat.js";

export const DEFAULT_SPEECH_POPUP_COMMAND = "speech-popup";

/** How long a popup command may take before it counts as broken. */
const COMMAND_TIMEOUT_MS = 5000;

/**
 * A pause before the popup comes back after an answer. Without it the window
 * appears the instant the answer lands, on top of what the user is still reading.
 */
const REOPEN_DELAY_MS = 2500;

export interface SpeechPopupResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

export type SpeechPopupRunner = (command: string, args: readonly string[]) => Promise<SpeechPopupResult>;

let runnerOverride: SpeechPopupRunner | null = null;

/** Replace process execution, for tests and for hosts that cannot spawn. */
export function configureSpeechPopupRunner(runner: SpeechPopupRunner | null): void {
  runnerOverride = runner;
}

/**
 * Windows Explorer's "Copy as path" hands out a quoted path, and a quoted path
 * is not a file name: execFile would look for one that includes the quotes. Take
 * the first token the way the MCP command field does, so a pasted path works.
 */
export function effectiveSpeechPopupCommand(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return DEFAULT_SPEECH_POPUP_COMMAND;
  // Only a quoted value is tokenized. An unquoted path is taken whole, because
  // "C:\Program Files\..." without quotes still means one file name.
  if (!trimmed.startsWith('"') && !trimmed.startsWith("'")) return trimmed;
  return splitCommandLine(trimmed)[0]?.trim() || DEFAULT_SPEECH_POPUP_COMMAND;
}

interface ExecFileModule {
  execFile(
    file: string,
    args: readonly string[],
    options: { timeout: number; windowsHide: boolean },
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ): unknown;
}

export type ObsidianSandbox = "none" | "flatpak" | "snap";

/**
 * Which sandbox this Obsidian runs in, if any. A Flatpak or Snap build cannot
 * see programs installed on the host, so a command that works in a terminal
 * fails here for a reason no error message explains on its own.
 */
export function obsidianSandbox(): ObsidianSandbox {
  const env = typeof process !== "undefined" ? process.env ?? {} : {};
  if (env.FLATPAK_ID || env.container === "flatpak") return "flatpak";
  if (env.SNAP) return "snap";
  try {
    // The definitive marker inside a Flatpak sandbox, present even when the
    // app was started in a way that did not export the variables above.
    const fs = getNodeModule<{ existsSync(path: string): boolean }>("fs");
    if (fs.existsSync("/.flatpak-info")) return "flatpak";
  } catch {
    // No Node, so nothing can be spawned anyway.
  }
  return "none";
}

/**
 * How to reach a program on the host. Flatpak provides a portal for exactly
 * this - the same `flatpak-spawn --host` other Obsidian plugins use to reach
 * their own binaries - while a Snap build has no equivalent, so the command is
 * left as it is and fails with an explanation instead.
 */
export function hostSpawnCommand(
  command: string,
  args: readonly string[],
  sandbox: ObsidianSandbox = obsidianSandbox(),
): { file: string; args: string[] } {
  if (sandbox !== "flatpak") return { file: command, args: [...args] };
  return { file: "flatpak-spawn", args: ["--host", command, ...args] };
}

/** What the user has to do about a sandbox, once a command has failed inside one. */
export function sandboxHint(sandbox: ObsidianSandbox = obsidianSandbox()): string | undefined {
  if (sandbox === "flatpak") {
    return "This Obsidian runs in a Flatpak sandbox and reaches the host through flatpak-spawn. Allow it once with: flatpak override --user --talk-name=org.freedesktop.Flatpak md.obsidian.Obsidian";
  }
  if (sandbox === "snap") {
    return "This Obsidian runs in a Snap sandbox, which cannot start programs installed on the host. The AppImage or the Flatpak build can.";
  }
  return undefined;
}

async function runSpeechPopup(command: string, args: readonly string[]): Promise<SpeechPopupResult> {
  if (runnerOverride) return runnerOverride(command, args);
  let execFile: ExecFileModule["execFile"];
  try {
    ({ execFile } = getNodeModule<ExecFileModule>("child_process"));
  } catch (error) {
    // Mobile, or a host without Node: the app simply is not reachable.
    return { ok: false, stdout: "", stderr: "", error: formatError(error) };
  }
  const spawned = hostSpawnCommand(command, args);
  return new Promise<SpeechPopupResult>((resolve) => {
    execFile(spawned.file, spawned.args, { timeout: COMMAND_TIMEOUT_MS, windowsHide: true }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout, stderr, error: error ? formatError(error) : undefined });
    });
  });
}

export interface SpeechPopupStatus {
  installed: boolean;
  daemonRunning: boolean;
  version: string;
  /** Why the command produced nothing, for a host to show the user. */
  error?: string;
}

/**
 * `speech-popup status` succeeds whether or not the daemon listens, so being
 * installed is read from its own banner and the daemon from the report below it.
 */
export function parseSpeechPopupStatus(stdout: string): SpeechPopupStatus {
  const version = /^speech-popup\s+(\S+)/m.exec(stdout)?.[1] ?? "";
  return {
    installed: Boolean(version),
    daemonRunning: /^daemon:\s*running\b/m.test(stdout),
    version,
  };
}

function failureDetail(result: SpeechPopupResult): string | undefined {
  const detail = result.stderr.trim() || result.error || undefined;
  const hint = sandboxHint();
  if (!hint) return detail;
  return detail ? `${detail}\n${hint}` : hint;
}

export async function speechPopupStatus(command = ""): Promise<SpeechPopupStatus> {
  const resolved = effectiveSpeechPopupCommand(command);
  const result = await runSpeechPopup(resolved, ["status"]);
  const status = parseSpeechPopupStatus(result.stdout);
  if (status.installed) return status;
  return { ...status, error: `${resolved} status: ${failureDetail(result) ?? "no output"}` };
}

/**
 * Show the popup, asking it to mark what it pastes so the answer is
 * recognisable. A speech-popup too old for `--append` refuses the command and
 * says so, which is the right outcome: without the marker the conversation
 * cannot tell an answer from any other clipboard paste.
 */
export async function showSpeechPopup(command = "", marker = VOICE_CHAT_MARKER): Promise<SpeechPopupResult> {
  const resolved = effectiveSpeechPopupCommand(command);
  const args = marker ? ["show", "--append", marker] : ["show"];
  const result = await runSpeechPopup(resolved, args);
  if (result.ok) return result;
  return { ...result, error: `${resolved} show: ${failureDetail(result) ?? "failed"}` };
}

export interface VoiceConversationSession {
  /** speech-popup answered `status`, so the microphone button is worth showing. */
  available: boolean;
  active: boolean;
  /**
   * Show the popup and keep the conversation on. Opening is idempotent because
   * nothing tells the plugin when the popup was closed: a click that could mean
   * "end" would be spent on a session the user already left, and the popup
   * would not appear until the next click.
   */
  open: () => void;
  end: () => void;
}

export interface VoiceConversationOptions {
  /** Custom binary path. Empty uses `speech-popup` from PATH. */
  command?: string;
  /** Surfaces a failed popup to the user; the host owns how it is shown. */
  onError?: (message: string) => void;
  /**
   * Called after the popup opens. speech-popup pastes into whatever element has
   * focus, so the host has to hand focus back to its composer.
   */
  onOpened?: () => void;
  /**
   * Called when a session begins, so the host can switch reading aloud on. A
   * later turn still reopens the popup even if the user switches reading off.
   */
  onStarted?: () => void;
  /** Overrides the pause before the popup returns after an answer. */
  reopenDelayMs?: number;
  /**
   * The chat this conversation belongs to. Moving to another chat, or starting a
   * new one, ends the mode: the chip is easy to miss, and a conversation that
   * followed the user into an unrelated chat would keep opening the popup.
   */
  chatId?: string | null;
  /**
   * Whether the answer is being read aloud. With reading on, the popup opens only
   * after the reading stops: an open microphone would otherwise transcribe the
   * plugin's own speech back into the next question.
   */
  readAloud?: boolean;
}

export function useVoiceConversation<M extends { role: string; content: string }>(
  messages: readonly M[],
  isLoading: boolean,
  { command = "", chatId = null, onError, onOpened, onStarted, readAloud = false, reopenDelayMs = REOPEN_DELAY_MS }: VoiceConversationOptions = {},
): VoiceConversationSession {
  const [status, setStatus] = useState<SpeechPopupStatus | null>(null);
  const [active, setActive] = useState(false);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    let cancelled = false;
    void speechPopupStatus(command).then((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => { cancelled = true; };
  }, [command]);

  // A configured command keeps the button, even when `status` failed: hiding it
  // leaves the user with nothing to click and no way to see what went wrong.
  const available = Boolean(status?.installed) || Boolean(command.trim());
  const statusError = status?.error;

  const open = useCallback(async (): Promise<boolean> => {
    const result = await showSpeechPopup(command);
    if (result.ok) {
      onOpened?.();
      return true;
    }
    setActive(false);
    const detail = result.error ?? statusError;
    onError?.(detail ? `${t("voice.popupFailed")}\n${detail}` : t("voice.popupFailed"));
    return false;
  }, [command, onError, onOpened, statusError]);

  // Bumped whenever a pending wait must be dropped, so a session that ended
  // while an answer was still being read does not reopen the popup afterwards.
  const waitToken = useRef(0);

  // The popup stays open: a paste it makes afterwards is recognisable by its
  // marker, and the text lands in the composer instead of being sent.
  const end = useCallback(() => {
    waitToken.current++;
    setActive(false);
    stopReadingAloud();
  }, []);

  const start = useCallback(() => {
    void (async () => {
      if (!await open()) return;
      if (activeRef.current) return;
      setActive(true);
      onStarted?.();
    })();
  }, [onStarted, open]);

  // The first save of a new chat only fills in its id (null -> id), which is the
  // same conversation and must not end anything.
  const previousChatId = useRef(chatId);
  useEffect(() => {
    const previous = previousChatId.current;
    previousChatId.current = chatId;
    if (previous === chatId || previous === null) return;
    end();
  }, [chatId, end]);

  // Reopen a moment after the turn lands, or, while it is read aloud, a moment
  // after the reading stops - whether that is the end of the answer or the user
  // cutting it short.
  const previousLoading = useRef(isLoading);
  useEffect(() => {
    const completed = previousLoading.current && !isLoading;
    previousLoading.current = isLoading;
    if (!completed || !active) return;
    if (messages[messages.length - 1]?.role !== "assistant") return;
    const token = ++waitToken.current;
    void (async () => {
      if (readAloud) await whenReadingSettles();
      await new Promise((resolve) => setTimeout(resolve, reopenDelayMs));
      // end() bumps the token, so a session left in the meantime stays closed.
      if (token !== waitToken.current || !activeRef.current) return;
      void open();
    })();
  }, [active, isLoading, messages, open, readAloud, reopenDelayMs]);

  return { available, active, open: start, end };
}
