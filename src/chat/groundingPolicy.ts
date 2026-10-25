import type { Message } from "../core/message.js";

export interface ChatSession { autoSaveDisabledByGrounding: boolean }

/** A one-way policy: changing provider, toggling search or saving cannot clear it. */
export class GroundingChatPolicies {
  private readonly restricted = new Set<string>();
  constructor(private readonly isRestricted?: (chatId: string) => boolean) {}
  get(chatId: string | null): ChatSession {
    return { autoSaveDisabledByGrounding: !!chatId && (this.restricted.has(chatId) || this.isRestricted?.(chatId) === true) };
  }
  restrict(chatId: string): void { this.restricted.add(chatId); }
  restore(chatId: string, session?: Partial<ChatSession>): void {
    if (session?.autoSaveDisabledByGrounding) this.restrict(chatId);
  }
  canAutoSave(chatId: string): boolean { return !this.get(chatId).autoSaveDisabledByGrounding; }
}

/** Restricted manual exports contain visible conversation text, not opaque provider data. */
export function messageForPersistence(message: Message, session?: Partial<ChatSession>): Message {
  if (!session?.autoSaveDisabledByGrounding && !message.googleSearchGrounding) return message;
  return { role: message.role, content: message.content, timestamp: message.timestamp,
    model: message.model, modelDisplayName: message.modelDisplayName,
    attachments: message.role === "user" ? message.attachments : undefined };
}
