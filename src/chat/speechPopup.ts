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
import { stopReadingAloud, whenReadingSettles } from "./voiceChat.js";

export const DEFAULT_SPEECH_POPUP_COMMAND = "speech-popup";

/** How long a popup command may take before it counts as broken. */
const COMMAND_TIMEOUT_MS = 5000;

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

async function runSpeechPopup(command: string, args: readonly string[]): Promise<SpeechPopupResult> {
  if (runnerOverride) return runnerOverride(command, args);
  let execFile: ExecFileModule["execFile"];
  try {
    ({ execFile } = getNodeModule<ExecFileModule>("child_process"));
  } catch (error) {
    // Mobile, or a host without Node: the app simply is not reachable.
    return { ok: false, stdout: "", stderr: "", error: formatError(error) };
  }
  return new Promise<SpeechPopupResult>((resolve) => {
    execFile(command, args, { timeout: COMMAND_TIMEOUT_MS, windowsHide: true }, (error, stdout, stderr) => {
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
  return result.stderr.trim() || result.error || undefined;
}

export async function speechPopupStatus(command = ""): Promise<SpeechPopupStatus> {
  const resolved = effectiveSpeechPopupCommand(command);
  const result = await runSpeechPopup(resolved, ["status"]);
  const status = parseSpeechPopupStatus(result.stdout);
  if (status.installed) return status;
  return { ...status, error: `${resolved} status: ${failureDetail(result) ?? "no output"}` };
}

export async function showSpeechPopup(command = ""): Promise<SpeechPopupResult> {
  const resolved = effectiveSpeechPopupCommand(command);
  const result = await runSpeechPopup(resolved, ["show"]);
  if (result.ok) return result;
  return { ...result, error: `${resolved} show: ${failureDetail(result) ?? "failed"}` };
}

export interface VoiceConversationSession {
  /** speech-popup answered `status`, so the microphone button is worth showing. */
  available: boolean;
  active: boolean;
  toggle: () => void;
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
  { command = "", onError, onOpened, onStarted, readAloud = false }: VoiceConversationOptions = {},
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

  const end = useCallback(() => {
    waitToken.current++;
    setActive(false);
    stopReadingAloud();
  }, []);

  const toggle = useCallback(() => {
    if (activeRef.current) {
      end();
      return;
    }
    void (async () => {
      if (!await open()) return;
      setActive(true);
      onStarted?.();
    })();
  }, [end, onStarted, open]);

  // Reopen when the turn lands, or, while it is read aloud, when the reading
  // stops - whether that is the end of the answer or the user cutting it short.
  const previousLoading = useRef(isLoading);
  useEffect(() => {
    const completed = previousLoading.current && !isLoading;
    previousLoading.current = isLoading;
    if (!completed || !active) return;
    if (messages[messages.length - 1]?.role !== "assistant") return;
    if (!readAloud) {
      void open();
      return;
    }
    const token = ++waitToken.current;
    void whenReadingSettles().then(() => {
      if (token !== waitToken.current || !activeRef.current) return;
      void open();
    });
  }, [active, isLoading, messages, open, readAloud]);

  return { available, active, toggle, end };
}
