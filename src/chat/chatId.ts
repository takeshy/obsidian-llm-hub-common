/** Identifies a chat in the history folder; also its file name. */
export function generateChatId(): string {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Is this the file name of a saved chat?
 *
 * The underscore prefix is what `generateChatId` produces; the hyphen is a
 * prefix obsidian-local-llm-hub's `/compact` used to mint, and those files are
 * still in people's vaults. Deleting the chat history has to recognise both,
 * or a chat the history list happily shows cannot be deleted.
 */
export function isSavedChatFileName(name: string): boolean {
  return /^chat[_-]/.test(name) && (name.endsWith(".md") || name.endsWith(".md.encrypted"));
}
