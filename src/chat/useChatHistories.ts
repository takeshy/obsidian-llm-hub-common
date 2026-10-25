import { GroundingChatPolicies, type ChatSession } from "./groundingPolicy.js";
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
  mergeChatHistory,
  pruneExpiredChats,
  readChatHistories,
  removeChatFiles,
  writeChatFile,
  writeChatNote,
  type ChatStorageHost,
} from "./chatStore.js";
import { generateChatId } from "./chatId.js";

export type SaveNoteState = "idle" | "saving" | "saved";

export interface SaveChatOptions {
  /** Explicit user save; permitted even when automatic history is disabled. */
  manual?: boolean;
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
  autoSaveDisabledByGrounding: boolean;
  getCurrentChatId: () => string | null;
  getChatSession: (chatId?: string | null) => ChatSession;
  disableAutoSaveByGrounding: () => Promise<string>;
  restoreChatSession: (chatId: string, session?: Partial<ChatSession>) => void;
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
  decryptChat: (chatId: string, password: string) => Promise<{ messages: Message[]; createdAt: number; cliSession?: CliSessionInfo; autoSaveDisabledByGrounding?: boolean }>;
}

/**
 * Owns the saved-chat list and everything that writes it to disk. The host supplies only the
 * folders and settings (see {@link ChatStorageHost}); the read/write/prune behaviour is the
 * same in every plugin, so it lives here and cannot drift.
 */
export function useChatHistories(host: ChatStorageHost): ChatHistoriesApi {
  const [chatHistories, setChatHistories] = useState<ChatHistory[]>([]);
  const [currentChatId, setCurrentChatIdState] = useState<string | null>(null);
  const currentChatIdRef = useRef<string | null>(null);
  const activeChatRevisionRef = useRef(0);
  const [, setPolicyRevision] = useState(0);
  const historiesRef = useRef(chatHistories);
  historiesRef.current = chatHistories;
  const [saveNoteState, setSaveNoteState] = useState<SaveNoteState>("idle");
  // Chats the user deleted while a stream was still running: a late save must not resurrect them.
  const deletedChatIdsRef = useRef<Set<string>>(new Set());
  // Which note each chat was last exported to, so re-saving overwrites instead of piling up.
  const savedNotePathsRef = useRef(new Map<string, string>());
  // `host` is rebuilt on every render by the caller; read it through a ref so the callbacks
  // below stay stable and never close over a stale settings snapshot.
  const hostRef = useRef(host);
  hostRef.current = host;

  const policies = useRef(new GroundingChatPolicies(id => hostRef.current.isChatAutoSaveDisabled?.(id) === true));
  const getChatSession = useCallback((id?: string | null) => policies.current.get(id === undefined ? currentChatIdRef.current : id), []);
  const getCurrentChatId = useCallback(() => currentChatIdRef.current, []);
  const setCurrentChatId: Dispatch<SetStateAction<string | null>> = useCallback(value => {
    const next = typeof value === "function" ? value(currentChatIdRef.current) : value;
    activeChatRevisionRef.current++;
    currentChatIdRef.current = next;
    setCurrentChatIdState(next);
  }, []);
  const restoreChatSession = useCallback((id: string, session?: Partial<ChatSession>) => {
    policies.current.restore(id, session);
    setPolicyRevision(value => value + 1);
  }, []);
  const disableAutoSaveByGrounding = useCallback(async () => {
    const id = currentChatIdRef.current ?? generateChatId();
    policies.current.restrict(id);
    setCurrentChatId(id);
    setPolicyRevision(value => value + 1);
    await hostRef.current.onGroundingChatRestricted?.(id);
    return id;
  }, [setCurrentChatId]);
  const storageHost = (): ChatStorageHost => ({ ...hostRef.current,
    isChatAutoSaveDisabled: id => getChatSession(id).autoSaveDisabledByGrounding,
  });

  const loadChatHistories = useCallback(async () => {
    const histories = await readChatHistories(hostRef.current);
    for (const history of histories) policies.current.restore(history.id, history);
    historiesRef.current = histories;
    setChatHistories(histories);
  }, []);

  const saveChatToDisk = useCallback(async (
    msgs: Message[],
    chatId: string,
    opts: SaveChatOptions = {},
  ) => {
    const current = storageHost();
    const foregroundRevision = activeChatRevisionRef.current;
    if (msgs.length === 0) return;
    if (!opts.manual && (!current.isHistoryEnabled() || !policies.current.canAutoSave(chatId))) return;
    if (deletedChatIdsRef.current.has(chatId)) return;

    const { session, foreground = false } = opts;
    try {
      await ensureFolderExists(current.app, current.getChatHistoryFolder());
    } catch {
      // Folder might already exist
    }

    if (!opts.manual && !policies.current.canAutoSave(chatId)) return;
    const existing = historiesRef.current.find(history => history.id === chatId);
    const createdAt = existing?.createdAt || Date.now();
    const effectiveSession = session === undefined ? existing?.cliSession : session ?? undefined;
    const chatSession = getChatSession(chatId);
    try {
      await writeChatFile(current, msgs, chatId, createdAt, effectiveSession, { manual: opts.manual, chatSession });
    } catch (error) {
      if (opts.manual) throw error;
      console.warn("Failed to write chat file:", chatId, error);
      return;
    }
    if (!opts.manual && !policies.current.canAutoSave(chatId)) return;
    setChatHistories(prev => {
      const { histories, expired } = mergeChatHistory(prev, {
        id: chatId, title: chatTitleFromMessages(msgs), messages: msgs, createdAt, updatedAt: Date.now(),
        cliSession: effectiveSession,
        ...(chatSession.autoSaveDisabledByGrounding ? { autoSaveDisabledByGrounding: true } : {}),
      }, current.getMaxSavedChatHistories());
      historiesRef.current = histories;
      pruneExpiredChats(current, expired);
      return histories;
    });

    if (foreground && foregroundRevision === activeChatRevisionRef.current) {
      setCurrentChatId(chatId);
    }
  }, []);

  const saveCurrentChat = useCallback(async (
    msgs: Message[],
    opts: SaveChatOptions & { chatId?: string } = {},
  ) => {
    const { chatId, ...saveOpts } = opts;
    await saveChatToDisk(msgs, chatId || currentChatIdRef.current || generateChatId(), {
      ...saveOpts,
      foreground: true,
    });
  }, [saveChatToDisk]);

  const deleteChat = useCallback(async (chatId: string) => {
    // Prevent background streams from resurrecting this chat
    deletedChatIdsRef.current.add(chatId);
    await removeChatFiles(hostRef.current, chatId);
    setChatHistories(prev => prev.filter(h => h.id !== chatId));
  }, []);

  const saveAsNote = useCallback(async (msgs: Message[]) => {
    if (saveNoteState === "saving" || msgs.length === 0) return;
    setSaveNoteState("saving");
    try {
      const currentId = currentChatIdRef.current;
      const chatKey = currentId ?? String(msgs[0].timestamp);
      const filePath = await writeChatNote(
        hostRef.current,
        msgs,
        savedNotePathsRef.current.get(chatKey),
        getChatSession(currentId),
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
    autoSaveDisabledByGrounding: getChatSession(currentChatId).autoSaveDisabledByGrounding,
    getCurrentChatId, getChatSession, disableAutoSaveByGrounding, restoreChatSession,
    loadChatHistories,
    saveChatToDisk,
    saveCurrentChat,
    deleteChat,
    saveAsNote,
    decryptChat: decrypt,
  };
}
