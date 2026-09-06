import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Message } from "../core/message.js";
import type { CliSessionInfo } from "./chatUtils.js";
import { generateChatId } from "./chatId.js";
import type { SaveChatOptions } from "./useChatHistories.js";

/** How many detached streams may keep running before the oldest is aborted. */
export const MAX_BACKGROUND_STREAMS = 3;

export interface StreamSession {
  /** The session id this stream was started under. */
  mySessionId: number;
  /** The chat this stream writes to, even after the user navigates away. */
  myChatId: string;
  /** False once the user started or loaded another chat: this stream no longer owns the UI. */
  isActive: () => boolean;
  /** Applies a result: to the screen and disk while active, silently to disk once detached. */
  saveResult: (msgs: Message[], session?: CliSessionInfo | null) => Promise<void>;
  /**
   * Call in `finally`. Clears the UI when this stream still owns it; otherwise drops the
   * stream's AbortController from the background list.
   */
  cleanup: (myAbortController?: AbortController | null) => void;
}

export interface ChatStreamSessionsOptions {
  setMessages: Dispatch<SetStateAction<Message[]>>;
  saveChatToDisk: (msgs: Message[], chatId: string, opts?: SaveChatOptions) => Promise<void>;
  currentChatId: string | null;
  /**
   * Host teardown when a running stream is pushed to the background: the stream still owns
   * its resources, so the host should only let go of them (drop the MCP executor reference).
   */
  onDetachStream?: () => void;
  /**
   * Host teardown when the view leaves a chat with nothing running: no one else owns the
   * resources, so the host should actually release them (clean the MCP executor up).
   */
  onLeaveIdle?: () => void;
}

export interface ChatStreamSessionsApi {
  isLoading: boolean;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  streamingContent: string;
  setStreamingContent: Dispatch<SetStateAction<string>>;
  streamingThinking: string;
  setStreamingThinking: Dispatch<SetStateAction<string>>;
  /** The foreground stream's AbortController, if one is running. */
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  /** Bumped whenever the UI moves to another chat; a stream compares against its own copy. */
  activeSessionIdRef: React.MutableRefObject<number>;
  /** Call once at the top of a send, before anything awaits. */
  createStreamSession: () => StreamSession;
  /** Leaves the running stream to finish in the background and frees the UI. */
  detachActiveStream: () => void;
  /** Stops the foreground stream outright (the stop button). */
  abortActiveStream: () => void;
  /**
   * Moves the UI to another chat. Detaches a running stream, or just invalidates pending
   * async work when nothing is running, so a late restore cannot overwrite the new chat.
   */
  leaveCurrentChat: () => void;
}

/**
 * Tracks which stream owns the chat view. A stream that is still running when the user
 * switches chats keeps going in the background and saves its result to the chat it started
 * in, instead of writing into whatever the user opened next.
 */
export function useChatStreamSessions(options: ChatStreamSessionsOptions): ChatStreamSessionsApi {
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const abortControllerRef = useRef<AbortController | null>(null);
  // Session id of the chat currently on screen; incremented on new chat / load chat
  // so background streams can detect they've been detached from the UI.
  const activeSessionIdRef = useRef(0);
  // AbortControllers for background (detached) streams, capped at MAX_BACKGROUND_STREAMS.
  const backgroundAbortControllersRef = useRef<AbortController[]>([]);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  // Read by callbacks that must stay stable, so they never see a stale `isLoading`.
  const isLoadingRef = useRef(isLoading);
  isLoadingRef.current = isLoading;

  const createStreamSession = useCallback((): StreamSession => {
    const { currentChatId, setMessages, saveChatToDisk } = optionsRef.current;
    const mySessionId = activeSessionIdRef.current;
    const myChatId = currentChatId || generateChatId();
    const isActive = () => mySessionId === activeSessionIdRef.current;

    const saveResult = async (msgs: Message[], session?: CliSessionInfo | null) => {
      if (isActive()) {
        setMessages(msgs);
        await saveChatToDisk(msgs, myChatId, { session, foreground: true });
      } else {
        await saveChatToDisk(msgs, myChatId, { session });
      }
    };

    const cleanup = (myAbortController?: AbortController | null) => {
      if (isActive()) {
        setIsLoading(false);
        setStreamingContent("");
        setStreamingThinking("");
        abortControllerRef.current = null;
      } else if (myAbortController) {
        const bgList = backgroundAbortControllersRef.current;
        backgroundAbortControllersRef.current = bgList.filter(ac => ac !== myAbortController);
      }
    };

    return { mySessionId, myChatId, isActive, saveResult, cleanup };
  }, []);

  const detachActiveStream = useCallback(() => {
    activeSessionIdRef.current += 1;

    // Move the foreground AbortController to the background list
    if (abortControllerRef.current) {
      backgroundAbortControllersRef.current.push(abortControllerRef.current);
      abortControllerRef.current = null;
      // Abort oldest if over the cap
      while (backgroundAbortControllersRef.current.length > MAX_BACKGROUND_STREAMS) {
        const oldest = backgroundAbortControllersRef.current.shift();
        oldest?.abort();
      }
    }

    optionsRef.current.onDetachStream?.();
    setIsLoading(false);
    setStreamingContent("");
    setStreamingThinking("");
  }, []);

  const abortActiveStream = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const leaveCurrentChat = useCallback(() => {
    // A live AbortController means a stream is running even if `isLoading` has not
    // rendered yet; either way it must be detached rather than left dangling.
    if (isLoadingRef.current || abortControllerRef.current) {
      detachActiveStream();
      return;
    }
    // Bump the session id even with no stream running, so async work started earlier
    // (a mount-time restore, say) sees that it no longer owns the view.
    activeSessionIdRef.current += 1;
    optionsRef.current.onLeaveIdle?.();
  }, [detachActiveStream]);

  return {
    isLoading,
    setIsLoading,
    streamingContent,
    setStreamingContent,
    streamingThinking,
    setStreamingThinking,
    abortControllerRef,
    activeSessionIdRef,
    createStreamSession,
    detachActiveStream,
    abortActiveStream,
    leaveCurrentChat,
  };
}
