import { describe, it, expect, beforeEach } from "vitest";
import { TFile } from "obsidian";
import type { Message } from "../core/message.js";
import type { ChatHistory } from "./chatUtils.js";
import {
  chatFilePath,
  chatNoteFileName,
  chatTitleFromMessages,
  ensureFolderExists,
  mergeChatHistory,
  readChatHistories,
  removeChatFiles,
  writeChatFile,
  writeChatNote,
  type ChatStorageHost,
} from "./chatStore.js";

/** An in-memory stand-in for the vault adapter, so the store is tested against real paths. */
class FakeAdapter {
  files = new Map<string, string>();
  folders = new Set<string>();
  exists(path: string) {
    const isFolder = this.folders.has(path)
      || [...this.files.keys()].some(f => f.startsWith(`${path}/`));
    return Promise.resolve(this.files.has(path) || isFolder);
  }
  mkdir(path: string) { this.folders.add(path); return Promise.resolve(); }
  read(path: string) {
    const content = this.files.get(path);
    if (content === undefined) return Promise.reject(new Error(`no such file: ${path}`));
    return Promise.resolve(content);
  }
  write(path: string, content: string) { this.files.set(path, content); return Promise.resolve(); }
  remove(path: string) { this.files.delete(path); return Promise.resolve(); }
  stat(_path: string) { return Promise.resolve({ ctime: 100, mtime: 200 }); }
  list(folder: string) {
    const prefix = `${folder}/`;
    return Promise.resolve({
      files: [...this.files.keys()].filter(p => p.startsWith(prefix)),
      folders: [],
    });
  }
}

let adapter: FakeAdapter;
let host: ChatStorageHost;
let trashed: string[];
/** Paths the vault itself knows about, i.e. the ones that can go to the trash. */
let tracked: Set<string>;

beforeEach(() => {
  adapter = new FakeAdapter();
  trashed = [];
  tracked = new Set();
  host = {
    app: {
      vault: {
        adapter,
        getAbstractFileByPath: (path: string) => {
          if (!tracked.has(path)) return null;
          const file = new TFile();
          file.path = path;
          return file;
        },
      },
      fileManager: {
        trashFile: (file: TFile) => { trashed.push(file.path); adapter.files.delete(file.path); return Promise.resolve(); },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Only the parts the store touches.
    } as any,
    getChatHistoryFolder: () => "AI/chats",
    getManualChatSaveFolder: () => "Notes",
    isHistoryEnabled: () => true,
    getMaxSavedChatHistories: () => 3,
    getEncryption: () => undefined,
  };
});

function msg(content: string, role: Message["role"] = "user"): Message {
  return { role, content, timestamp: 1 };
}

describe("chatStore", () => {
  it("creates every missing folder segment", async () => {
    await ensureFolderExists(host.app, "a/b/c");
    expect([...adapter.folders]).toEqual(["a", "a/b", "a/b/c"]);
  });

  it("writes and reads a chat back", async () => {
    await writeChatFile(host, [msg("hello"), msg("hi", "assistant")], "chat_1", 42);
    expect([...adapter.files.keys()]).toEqual(["AI/chats/chat_1.md"]);

    const histories = await readChatHistories(host);
    expect(histories).toHaveLength(1);
    expect(histories[0].id).toBe("chat_1");
    expect(histories[0].title).toBe("hello");
    expect(histories[0].createdAt).toBe(42);
    expect(histories[0].messages.map(m => m.content)).toEqual(["hello", "hi"]);
  });

  it("reads nothing when history is turned off", async () => {
    await writeChatFile(host, [msg("hello")], "chat_1", 42);
    host.isHistoryEnabled = () => false;
    expect(await readChatHistories(host)).toEqual([]);
  });

  it("removes both spellings of a chat file", async () => {
    adapter.files.set("AI/chats/chat_1.md", "x");
    adapter.files.set("AI/chats/chat_1.md.encrypted", "y");
    await removeChatFiles(host, "chat_1");
    expect(adapter.files.size).toBe(0);
  });

  it("sends a deleted chat to the trash when the vault knows the file", async () => {
    adapter.files.set("AI/chats/chat_1.md", "x");
    tracked.add("AI/chats/chat_1.md");
    await removeChatFiles(host, "chat_1");
    expect(trashed).toEqual(["AI/chats/chat_1.md"]);
    expect(adapter.files.size).toBe(0);
  });

  it("titles a chat by what the user said first, on one line and elided", () => {
    expect(chatTitleFromMessages([msg("short")])).toBe("short");
    expect(chatTitleFromMessages([msg("x".repeat(60))])).toBe(`${"x".repeat(50)}...`);
    expect(chatTitleFromMessages([msg("primed", "assistant"), msg("asked")])).toBe("asked");
    expect(chatTitleFromMessages([msg(" a\nb ")])).toBe("a b");
    expect(chatTitleFromMessages([])).toBe("Chat");
    expect(chatTitleFromMessages([msg("  ")])).toBe("Chat");
  });

  it("builds the chat file path from the host's folder", () => {
    expect(chatFilePath(host, "chat_1")).toBe("AI/chats/chat_1.md");
  });

  it("strips path-hostile characters from an exported note's name", () => {
    const name = chatNoteFileName('..a/b:c*?"<>|#^[]\n  d..', new Date(2026, 8, 6, 7, 8, 9));
    expect(name).toBe("20260906-070809_a b c d.md");
  });

  it("falls back to a placeholder when a title has nothing usable left", () => {
    expect(chatNoteFileName("///", new Date(2026, 0, 2, 3, 4, 5))).toBe("20260102-030405_Chat.md");
  });

  it("re-saves an exported note over its previous path", async () => {
    const first = await writeChatNote(host, [msg("hello")]);
    expect(first.startsWith("Notes/")).toBe(true);
    const second = await writeChatNote(host, [msg("hello"), msg("more")], first);
    expect(second).toBe(first);
    expect([...adapter.files.keys()]).toEqual([first]);
  });

  it("writes an exported note to the vault root when no folder is configured", async () => {
    host.getManualChatSaveFolder = () => "  ";
    const path = await writeChatNote(host, [msg("hello")]);
    expect(path).not.toContain("/");
  });
});

describe("mergeChatHistory", () => {
  const entry = (id: string, updatedAt: number): ChatHistory =>
    ({ id, title: id, messages: [], createdAt: 0, updatedAt });

  it("replaces the matching chat rather than adding a second one", () => {
    const prev = [entry("a", 1), entry("b", 2)];
    const { histories } = mergeChatHistory(prev, entry("a", 9), 10);
    expect(histories.map(h => h.id)).toEqual(["a", "b"]);
    expect(histories[0].updatedAt).toBe(9);
  });

  it("keeps the newest chats and reports the ones that aged out", () => {
    const prev = [entry("a", 3), entry("b", 2), entry("c", 1)];
    const { histories, expired } = mergeChatHistory(prev, entry("d", 4), 2);
    expect(histories.map(h => h.id)).toEqual(["d", "a"]);
    expect(expired.map(h => h.id)).toEqual(["b", "c"]);
  });

  it("treats a limit of 0 as no limit", () => {
    const prev = [entry("a", 1), entry("b", 2)];
    const { histories, expired } = mergeChatHistory(prev, entry("c", 3), 0);
    expect(histories).toHaveLength(3);
    expect(expired).toEqual([]);
  });
});
