/** Identifies a chat in the history folder; also its file name. */
export function generateChatId(): string {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
