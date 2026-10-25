import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
// Types are not needed by this runtime hook test.
// @ts-ignore
import TestRenderer, { act } from "react-test-renderer";
import { useChatHistories, type ChatHistoriesApi } from "./useChatHistories.js";
import { parseMarkdownToMessages } from "./chatHistory.js";
import type { ChatStorageHost } from "./chatStore.js";
import type { Message } from "../core/message.js";

let api: ChatHistoriesApi;
let tree: ReturnType<typeof TestRenderer.create>;
let files: Map<string, string>;
let host: ChatStorageHost;
let restricted: Set<string>;
const message = (content: string): Message => ({ role: "user", content, timestamp: 1 });
function mount() {
  function Harness() { api = useChatHistories(host); return null; }
  act(() => { tree = TestRenderer.create(React.createElement(Harness)); });
}
beforeEach(() => {
  vi.stubGlobal("window", { setTimeout: () => 0 });
  files = new Map(); restricted = new Set();
  host = {
    app: { vault: { adapter: {
      exists: async (path: string) => (!path.endsWith(".md") && !path.endsWith(".encrypted")) || files.has(path), mkdir: async () => {},
      remove: async (path: string) => { files.delete(path); },
      write: async (path: string, content: string) => { files.set(path, content); },
      read: async (path: string) => files.get(path), list: async () => ({ files: [...files.keys()] }), stat: async () => ({ ctime: 1, mtime: 1 }),
    } } } as unknown as ChatStorageHost["app"],
    getChatHistoryFolder: () => "chats", getManualChatSaveFolder: () => "notes", isHistoryEnabled: () => true,
    getMaxSavedChatHistories: () => 0, getEncryption: () => undefined,
    isChatAutoSaveDisabled: id => restricted.has(id),
    onGroundingChatRestricted: id => { restricted.add(id); },
  };
  mount();
});
afterEach(() => { act(() => tree.unmount()); vi.unstubAllGlobals(); });

describe("automatic/manual saving of Grounding conversations", () => {
  it("saves explicit snapshots to the configured note folder and never overwrites the automatic history", async () => {
    await act(async () => { await api.saveCurrentChat([message("before")], { chatId: "one" }); });
    const before = files.get("chats/one.md");
    await act(async () => { await api.disableAutoSaveByGrounding(); });
    expect(api.autoSaveDisabledByGrounding).toBe(true);
    expect(files.get("chats/one.md")).toBe(before);
    await act(async () => { await api.saveCurrentChat([message("after search")]); });
    expect(files.get("chats/one.md")).toBe(before);
    await act(async () => { await api.saveAsNote([message("before"), message("manual snapshot")]); });
    const savedPath = [...files.keys()].find(path => path.startsWith("notes/"))!;
    expect(savedPath).toBeDefined();
    const saved = files.get(savedPath)!;
    expect(files.get("chats/one.md")).toBe(before);
    expect(saved).toContain("manual snapshot");
    expect(parseMarkdownToMessages(saved)?.autoSaveDisabledByGrounding).toBe(true);
    await act(async () => { await api.saveChatToDisk([message("later auto change")], "one"); });
    expect(files.get(savedPath)).toBe(saved);
    expect(files.get("chats/one.md")).toBe(before);
    await act(async () => { await api.saveAsNote([message("new manual snapshot")]); });
    expect(files.get(savedPath)).toContain("new manual snapshot");
    expect(files.get("chats/one.md")).toBe(before);
    act(() => { api.setCurrentChatId(null); });
    expect(api.autoSaveDisabledByGrounding).toBe(false);
    await act(async () => { await api.saveChatToDisk([message("late background result")], "one"); });
    expect(files.get("chats/one.md")).not.toContain("late background result");
    await act(async () => { await api.saveCurrentChat([message("new normal chat")], { chatId: "two" }); });
    expect(files.get("chats/two.md")).toContain("new normal chat");
    act(() => { api.setCurrentChatId("one"); });
    expect(api.autoSaveDisabledByGrounding).toBe(true);
  });
  it("restores the restriction from a manually saved file without requiring the old in-memory journal", async () => {
    await act(async () => { await api.disableAutoSaveByGrounding(); });
    const id = api.getCurrentChatId()!;
    await act(async () => { await api.saveAsNote([message("saved conversation")]); });
    const savedPath = [...files.keys()].find(path => path.startsWith("notes/"))!;
    const snapshot = files.get(savedPath)!;
    const parsed = parseMarkdownToMessages(snapshot)!;
    expect(parsed.messages.map(message => message.content)).toEqual(["saved conversation"]);
    act(() => tree.unmount()); restricted.clear(); mount();
    act(() => { api.restoreChatSession(id, parsed); api.setCurrentChatId(id); });
    expect(api.autoSaveDisabledByGrounding).toBe(true);
    await act(async () => { await api.saveCurrentChat([message("do not overwrite")]); });
    expect(files.get(savedPath)).toBe(snapshot);
    expect(files.has(`chats/${id}.md`)).toBe(false);
  });
  it("allows explicit saving when global automatic history is disabled", async () => {
    host.isHistoryEnabled = () => false;
    await act(async () => { await api.disableAutoSaveByGrounding(); });
    await act(async () => { await api.saveAsNote([message("manual")]); });
    expect(files.size).toBe(1);
    const [path, markdown] = [...files.entries()][0];
    expect(path.startsWith("notes/")).toBe(true);
    expect(markdown).toContain("manual");
  });
});


it("uses the vault root when the manual save folder is empty, including restricted chats", async () => {
  host.getManualChatSaveFolder = () => "";
  await act(async () => { await api.disableAutoSaveByGrounding(); });
  await act(async () => { await api.saveAsNote([message("root snapshot")]); });
  const [path, markdown] = [...files.entries()][0];
  expect(path).not.toContain("/");
  expect(parseMarkdownToMessages(markdown)?.autoSaveDisabledByGrounding).toBe(true);
});

it("uses a changed manual folder instead of a cached path from the old folder", async () => {
  await act(async () => { await api.disableAutoSaveByGrounding(); });
  await act(async () => { await api.saveAsNote([message("first snapshot")]); });
  const firstPath = [...files.keys()][0];
  host.getManualChatSaveFolder = () => "Changed/Chats";
  await act(async () => { await api.saveAsNote([message("second snapshot")]); });
  expect(files.get(firstPath)).toContain("first snapshot");
  const secondPath = [...files.keys()].find(path => path.startsWith("Changed/Chats/"))!;
  expect(files.get(secondPath)).toContain("second snapshot");
  expect(files.size).toBe(2);
});
