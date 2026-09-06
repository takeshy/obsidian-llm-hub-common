import { describe, expect, it } from "vitest";
import { generateChatId, isSavedChatFileName } from "./chatId.js";

describe("saved chat files", () => {
  it("recognises the file a generated id names", () => {
    // The generator and the matcher have to agree, or "delete chat history"
    // silently leaves chats behind.
    expect(isSavedChatFileName(`${generateChatId()}.md`)).toBe(true);
    expect(isSavedChatFileName(`${generateChatId()}.md.encrypted`)).toBe(true);
  });

  it("still recognises the hyphen prefix already in people's vaults", () => {
    expect(isSavedChatFileName("chat-1757000000000.md")).toBe(true);
  });

  it("leaves everything else in the folder alone", () => {
    // The chat folder also holds workspace state and whatever the host keeps
    // beside it.
    for (const name of ["workspace-state.json", "Notes.md", "chat_1.json", "chatter.md"]) {
      expect(isSavedChatFileName(name)).toBe(false);
    }
  });

  it("gives two chats made in the same millisecond different ids", () => {
    expect(generateChatId()).not.toBe(generateChatId());
  });
});
