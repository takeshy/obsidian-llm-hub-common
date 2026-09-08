/**
 * Persisted voice chat preferences. They live in core, not in the chat UI
 * entry, so a host's settings module can read the defaults without pulling the
 * React and Obsidian modal chain that `chat` brings with it.
 */
export interface VoiceChatSettings {
  submitOnPaste: boolean;
  /** Empty means the translated default for the current Obsidian language. */
  submitPhrase: string;
  autoReadAloud: boolean;
}

export const DEFAULT_VOICE_CHAT_SETTINGS: VoiceChatSettings = {
  submitOnPaste: false,
  submitPhrase: "",
  autoReadAloud: false,
};
