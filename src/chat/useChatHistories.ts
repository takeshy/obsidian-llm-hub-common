import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Notice } from "obsidian";
import { formatError } from "../core/error.js";
import { t } from "../i18n/index.js";
import type { Message } from "../core/message.js";
import type { ChatHistory, CliSessionInfo } from "./chatUtils.js";
import {
  chatTitleFromMessages,
  decryptChat,
  ensureFolderExists,
  generateChatId,
  mergeChatHistory,
  pruneExpiredChats,
  readChatHistories,
  removeChatFiles,
  writeChatFile,
  writeChatNote,
  type ChatStorageHost,
} from "./chatStore.js";

export type SaveNoteState = "idle" | "saving" | "saved";

export interface SaveChatOptions {
  /**
   * The CLI session to record with the chat. Undefined keeps whatever the saved chat
   * already had; null clears it. Hosts without CLI providers never pass it.
   */
  session?: CliSessionInfo | null;
  /** True for the chat the user is looking at, which also becomes the current chat. */
  foreground?: boolean;
}

export interface ChatHistoriesApi {
  chatHistories: ChatHistory[];
  setChatHistories: Dispatch<SetStateAction<ChatHistory[]>>;
  currentChatId: string | null;
  setCurrentChatId: Dispatch<SetStateAction<string | null>>;
  saveNoteState: SaveNoteState;
  /** Re-reads the history folder into `chatHistories`. */
  loadChatHistories: () => Promise<void>;
  /** Saves a chat by id — used by background streams, which must not touch the current chat. */
  saveChatToDisk: (msgs: Message[], chatId: string, opts?: SaveChatOptions) => Promise<void>;
  /** Saves the chat on screen, allocating an id the first time. */
  saveCurrentChat: (msgs: Message[], opts?: SaveChatOptions & { chatId?: string }) => Promise<void>;
  /** Deletes a chat's files and drops it from the list. */
  deleteChat: (chatId: string) => Promise<void>;
  /** Writes the conversation out as a readable note and reports it with a Notice. */
  saveAsNote: (msgs: Message[]) => Promise<void>;
  /** Reads an encrypted chat back with the given password. */
  decryptChat: (chatId: string, password: string) => Promise<{ messages: Message[]; createdAt: number; cliSession?: CliSessionInfo }>;
}

/**
 * Owns the saved-chat list and everything that writes it to disk. The host supplies only the
 * folders and settings (see {@link ChatStorageHost}); the read/write/prune behaviour is the
 * same in every plugin, so it lives here and cannot drift.
 */
export function useChatHistories(host: ChatStorageHost): ChatHistoriesApi {
  const [chatHistories, setChatHistories] = useState<ChatHistory[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [saveNoteState, setSaveNoteState] = useState<SaveNoteState>("idle");
  // Chats the user deleted while a stream was still running: a late save must not resurrect them.
  const deletedChatIdsRef = useRef<Set<string>>(new Set());
  // Which note each chat was last exported to, so re-saving overwrites instead of piling up.
  const savedNotePathsRef = useRef(new Map<string, string>());
  // `host` is rebuilt on every render by the caller; read it through a ref so the callbacks
  // below stay stable and never close over a stale settings snapshot.
  const hostRef = useRef(host);
  hostRef.current = host;

  const loadChatHistories = useCallback(async () => {
    setChatHistories(await readChatHistories(hostRef.current));
  }, []);

  const saveChatToDisk = useCallback(async (
    msgs: Message[],
    chatId: string,
    opts: SaveChatOptions = {},
  ) => {
    const current = hostRef.current;
    if (msgs.length === 0) return;
    if (!current.isHistoryEnabled()) return;
    if (deletedChatIdsRef.current.has(chatId)) return;

    const { session, foreground = false } = opts;
    try {
      await ensureFolderExists(current.app, current.getChatHistoryFolder());
    } catch {
      // Folder might already exist
    }

    // Read the latest list through the functional updater rather than the render closure,
    // so a background stream saving late still sees the current entry.
    setChatHistories(prev => {
      const existing = prev.find(h => h.id === chatId);
      const createdAt = existing?.createdAt || Date.now();
      // session explicitly passed → use it; undefined → keep what the chat already had
      const effectiveSession = session === undefined ? existing?.cliSession : session ?? undefined;

      // Fire-and-forget the disk write; the state update itself stays synchronous.
      void writeChatFile(current, msgs, chatId, createdAt, effectiveSession)
        .catch((e: unknown) => { console.warn("Failed to write chat file:", chatId, e); });

      const { histories, expired } = mergeChatHistory(prev, {
        id: chatId,
        title: chatTitleFromMessages(msgs),
        messages: msgs,
        createdAt,
        updatedAt: Date.now(),
        cliSession: effectiveSession,
      }, current.getMaxSavedChatHistories());
      pruneExpiredChats(current, expired);
      return histories;
    });

    if (foreground) {
      setCurrentChatId(chatId);
    }
  }, []);

  const saveCurrentChat = useCallback(async (
    msgs: Message[],
    opts: SaveChatOptions & { chatId?: string } = {},
  ) => {
    const { chatId, ...saveOpts } = opts;
    await saveChatToDisk(msgs, chatId || currentChatId || generateChatId(), {
      ...saveOpts,
      foreground: true,
    });
  }, [currentChatId, saveChatToDisk]);

  const deleteChat = useCallback(async (chatId: string) => {
    // Prevent background streams from resurrecting this chat
    deletedChatIdsRef.current.add(chatId);
    await removeChatFiles(hostRef.current, chatId);
    setChatHistories(prev => prev.filter(h => h.id !== chatId));
  }, []);

  const saveAsNote = useCallback(async (msgs: Message[]) => {
    if (saveNoteState !== "idle" || msgs.length === 0) return;
    setSaveNoteState("saving");
    try {
      const chatKey = currentChatId ?? String(msgs[0].timestamp);
      const filePath = await writeChatNote(
        hostRef.current,
        msgs,
        savedNotePathsRef.current.get(chatKey),
      );
      savedNotePathsRef.current.set(chatKey, filePath);
      new Notice(t("chat.savedAsNote", { path: filePath }));
      setSaveNoteState("saved");
      window.setTimeout(() => setSaveNoteState("idle"), 3000);
    } catch (error) {
      // The translated string already ends in its own separator.
      new Notice(t("common.error") + formatError(error));
      setSaveNoteState("idle");
    }
  }, [saveNoteState, currentChatId]);

  const decrypt = useCallback(
    (chatId: string, password: string) => decryptChat(hostRef.current, chatId, password),
    [],
  );

  return {
    chatHistories,
    setChatHistories,
    currentChatId,
    setCurrentChatId,
    saveNoteState,
    loadChatHistories,
    saveChatToDisk,
    saveCurrentChat,
    deleteChat,
    saveAsNote,
    decryptChat: decrypt,
  };
}
