import { TFile, type App } from "obsidian";
import { isEncryptedFile, decryptFileContent } from "../core/crypto.js";
import { cryptoCache } from "../core/cryptoCache.js";
import { formatError } from "../core/error.js";
import { t } from "../i18n/index.js";
import type { Message } from "../core/message.js";
import type { ChatHistory, CliSessionInfo } from "./chatUtils.js";
import { generateChatId } from "./chatId.js";
import {
  messagesToMarkdown,
  messagesToCompactMarkdown,
  parseMarkdownToMessages,
  type EncryptionConfig,
} from "./chatHistory.js";

/**
 * What a host must tell the store about itself. The folders are host-owned because each
 * plugin keeps its histories in its own place and moving them would orphan saved chats.
 */
export interface ChatStorageHost {
  app: App;
  /** Folder holding the chat history files. */
  getChatHistoryFolder(): string;
  /** Folder that "save as note" writes into; empty means the vault root. */
  getManualChatSaveFolder(): string;
  /** When false, nothing is written and the history list stays empty. */
  isHistoryEnabled(): boolean;
  /** Number of chats to keep; 0 or less means "keep everything". */
  getMaxSavedChatHistories(): number;
  /** Undefined writes plaintext Markdown. */
  getEncryption(): EncryptionConfig | undefined;
}

/**
 * The title shown in the history list: the first thing the user said, on one line and elided.
 * Skips any system or assistant message a host puts at the front of a conversation.
 */
export function chatTitleFromMessages(msgs: Message[]): string {
  const first = (msgs.find(m => m.role === "user") ?? msgs[0])?.content.replace(/\n/g, " ").trim() ?? "";
  if (!first) return "Chat";
  return first.slice(0, 50) + (first.length > 50 ? "..." : "");
}

export async function ensureFolderExists(app: App, folder: string): Promise<void> {
  let currentFolder = "";
  for (const segment of folder.split("/").filter(Boolean)) {
    currentFolder = currentFolder ? `${currentFolder}/${segment}` : segment;
    if (!(await app.vault.adapter.exists(currentFolder))) {
      await app.vault.adapter.mkdir(currentFolder);
    }
  }
}

export function chatFilePath(host: ChatStorageHost, chatId: string): string {
  return `${host.getChatHistoryFolder()}/${chatId}.md`;
}

/** Both spellings of a chat file: plaintext and encrypted. */
function chatFilePaths(host: ChatStorageHost, chatId: string): string[] {
  const base = chatFilePath(host, chatId);
  return [base, `${base}.encrypted`];
}

/** Reads every saved chat, newest first. Files that fail to parse are skipped. */
export async function readChatHistories(host: ChatStorageHost): Promise<ChatHistory[]> {
  if (!host.isHistoryEnabled()) return [];
  const { app } = host;
  try {
    const folder = host.getChatHistoryFolder();
    if (!(await app.vault.adapter.exists(folder))) return [];

    const listed = await app.vault.adapter.list(folder);
    const files = listed.files.filter(f => f.endsWith(".md") || f.endsWith(".md.encrypted"));
    const histories: ChatHistory[] = [];

    for (const filePath of files) {
      try {
        const content = await app.vault.adapter.read(filePath);
        const stat = await app.vault.adapter.stat(filePath);
        const fileName = filePath.split("/").pop() || "";
        // Extract chatId from filename (handles both .md and .md.encrypted)
        const chatId = fileName.replace(/\.md(\.encrypted)?$/, "");
        const ctime = stat?.ctime ?? 0;
        const mtime = stat?.mtime ?? 0;

        if (isEncryptedFile(content)) {
          histories.push({
            id: chatId,
            title: t("chat.encryptedChat"),
            messages: [],
            createdAt: ctime,
            updatedAt: mtime,
            isEncrypted: true,
          });
          continue;
        }

        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) continue;
        const titleMatch = frontmatterMatch[1].match(/title:\s*"([^"]+)"/);
        const createdAtMatch = frontmatterMatch[1].match(/createdAt:\s*(\d+)/);
        const updatedAtMatch = frontmatterMatch[1].match(/updatedAt:\s*(\d+)/);
        const parsed = parseMarkdownToMessages(content);

        histories.push({
          id: chatId,
          title: titleMatch ? titleMatch[1] : chatId,
          messages: parsed?.messages || [],
          createdAt: createdAtMatch ? parseInt(createdAtMatch[1]) : ctime,
          updatedAt: updatedAtMatch ? parseInt(updatedAtMatch[1]) : mtime,
          cliSession: parsed?.cliSession,
          isEncrypted: false,
        });
      } catch {
        // Failed to load chat, skip
      }
    }

    return histories.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

/**
 * Writes one chat. Encryption decides the file name, so the other spelling is removed
 * first — otherwise turning encryption on or off would leave a stale duplicate behind.
 */
export async function writeChatFile(
  host: ChatStorageHost,
  msgs: Message[],
  chatId: string,
  createdAt: number,
  session?: CliSessionInfo,
): Promise<void> {
  const { app } = host;
  const markdown = await messagesToMarkdown(
    msgs,
    chatTitleFromMessages(msgs),
    createdAt,
    host.getEncryption(),
    session,
  );
  const basePath = chatFilePath(host, chatId);
  const encrypted = isEncryptedFile(markdown);
  const filePath = encrypted ? `${basePath}.encrypted` : basePath;
  const oldPath = encrypted ? basePath : `${basePath}.encrypted`;

  if (await app.vault.adapter.exists(oldPath)) {
    await app.vault.adapter.remove(oldPath);
  }
  await app.vault.adapter.write(filePath, markdown);
}

/**
 * Removes a chat's file in both spellings. Deleted chats go to the vault trash so a
 * mis-click is recoverable; only files the vault does not know about are removed outright.
 * Missing files are not an error.
 */
export async function removeChatFiles(host: ChatStorageHost, chatId: string): Promise<void> {
  for (const path of chatFilePaths(host, chatId)) {
    try {
      const file = host.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        await host.app.fileManager.trashFile(file);
      } else if (await host.app.vault.adapter.exists(path)) {
        await host.app.vault.adapter.remove(path);
      }
    } catch {
      // Failed to delete chat file
    }
  }
}

/** Reads an encrypted chat back, caching the password for the rest of the session. */
export async function decryptChat(
  host: ChatStorageHost,
  chatId: string,
  password: string,
): Promise<{ messages: Message[]; createdAt: number; cliSession?: CliSessionInfo }> {
  // Try .md.encrypted first, then fall back to .md
  const basePath = chatFilePath(host, chatId);
  let file = host.app.vault.getAbstractFileByPath(`${basePath}.encrypted`);
  if (!(file instanceof TFile)) {
    file = host.app.vault.getAbstractFileByPath(basePath);
  }
  if (!(file instanceof TFile)) {
    throw new Error("Chat file not found");
  }

  const content = await host.app.vault.read(file);
  if (!isEncryptedFile(content)) {
    throw new Error("Invalid encrypted content");
  }

  const decrypted = await decryptFileContent(content, password);
  // Cache the password so the rest of this session's encrypted chats open without asking again.
  cryptoCache.setPassword(password);

  const parsed = parseMarkdownToMessages(decrypted);
  if (!parsed) {
    throw new Error("Failed to parse decrypted content");
  }
  return parsed;
}

/** A file name that survives every vault: no path separators, no leading or trailing dots. */
export function chatNoteFileName(title: string, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateTime = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const safeTitle = title
    .replace(/[\\/:*?"<>|#^[\]\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "")
    .trim()
    .slice(0, 80) || "Chat";
  return `${dateTime}_${safeTitle}.md`;
}

/**
 * Writes the conversation out as a readable note. `existingPath` re-saves over the note this
 * chat was written to before, so repeated saves of one chat do not litter the folder.
 */
export async function writeChatNote(
  host: ChatStorageHost,
  msgs: Message[],
  existingPath?: string,
): Promise<string> {
  const folder = host.getManualChatSaveFolder().trim();
  if (folder) await ensureFolderExists(host.app, folder);
  const filePath = existingPath
    ?? `${folder ? `${folder}/` : ""}${chatNoteFileName(chatTitleFromMessages(msgs))}`;
  await host.app.vault.adapter.write(filePath, messagesToCompactMarkdown(msgs));
  return filePath;
}

/**
 * Applies one saved chat to a history list: replaces the matching entry or prepends a new one,
 * then trims to the configured limit. Returns the list to keep plus the entries that aged out.
 */
export function mergeChatHistory(
  previous: ChatHistory[],
  entry: ChatHistory,
  limit: number,
): { histories: ChatHistory[]; expired: ChatHistory[] } {
  const idx = previous.findIndex(h => h.id === entry.id);
  let updated: ChatHistory[];
  if (idx >= 0) {
    updated = [...previous];
    updated[idx] = entry;
  } else {
    updated = [entry, ...previous];
  }
  updated.sort((a, b) => b.updatedAt - a.updatedAt);
  const max = Math.max(0, limit);
  if (max === 0 || updated.length <= max) return { histories: updated, expired: [] };
  return { histories: updated.slice(0, max), expired: updated.slice(max) };
}

/** Deletes the files of chats that aged out of the history list. */
export function pruneExpiredChats(host: ChatStorageHost, expired: ChatHistory[]): void {
  if (expired.length === 0) return;
  void Promise.all(expired.map(history => removeChatFiles(host, history.id)))
    .catch((error: unknown) => {
      console.warn("Failed to prune old chat histories:", formatError(error));
    });
}
