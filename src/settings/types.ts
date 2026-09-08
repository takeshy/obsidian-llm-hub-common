/** Settings shapes the shared sections read and write. */
export interface EncryptionSettings {
  enabled: boolean;  // Whether encryption keys are set up
  encryptChatHistory: boolean;  // Whether to encrypt AI chat history
  encryptWorkflowHistory: boolean;  // Whether to encrypt workflow execution logs
  publicKey: string;  // Base64 encoded public key (for encryption without password)
  encryptedPrivateKey: string;  // Base64 encoded encrypted private key
  salt: string;  // Base64 encoded salt for password derivation
}

export const DEFAULT_ENCRYPTION_SETTINGS: EncryptionSettings = {
  enabled: false,
  encryptChatHistory: false,
  encryptWorkflowHistory: false,
  publicKey: "",
  encryptedPrivateKey: "",
  salt: "",
};

export interface EditHistorySettings {
  enabled: boolean;
  diff: {
    contextLines: number;
  };
}

export const DEFAULT_EDIT_HISTORY_SETTINGS: EditHistorySettings = {
  enabled: true,
  diff: {
    contextLines: 3,
  },
};

export {
  DEFAULT_VOICE_CHAT_SETTINGS,
  type VoiceChatSettings,
} from "../core/voiceChatSettings.js";
