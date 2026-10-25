import type { GroundingRetention, Message } from "./message.js";

/**
 * Google Search Grounding retention rules (Gemini API Additional Terms, English version
 * effective 2026-03-23). A Grounded Result may be kept for chat-history viewing for at most
 * two years from when it was shown; Search Suggestions, grounding URLs/titles, queries and
 * citation offsets must not be stored at all. Only `webSearchUsed` and the retention stamp
 * survive a save.
 */
export const GROUNDING_RETENTION_YEARS = 2;

/** Every Google grounding redirect starts here; the links are grounding-derived by definition. */
const GROUNDING_REDIRECT_URL = /https?:\/\/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\/[^\s)<>"'\]]*/i;

export function groundingExpiresAt(displayedAt: number): number {
  const date = new Date(displayedAt);
  date.setUTCFullYear(date.getUTCFullYear() + GROUNDING_RETENTION_YEARS);
  return date.getTime();
}

export function createGroundingRetention(displayedAt: number = Date.now()): GroundingRetention {
  return { provider: "google_search", displayedAt, expiresAt: groundingExpiresAt(displayedAt) };
}

export function isGroundedResult(message: Message): boolean {
  return message.grounding?.provider === "google_search";
}

export function isExpiredGroundedResult(message: Message, now: number = Date.now()): boolean {
  return isGroundedResult(message) && message.grounding!.expiresAt <= now;
}

/**
 * Drops Grounded Results past their retention date. Only those messages go: the rest of the
 * conversation stays. Returns the same array when nothing expired, so callers can tell.
 * Use it on anything replayed to a model as well as on what is shown or saved.
 */
export function withoutExpiredGroundedResults(messages: Message[], now: number = Date.now()): Message[] {
  return messages.some(message => isExpiredGroundedResult(message, now))
    ? messages.filter(message => !isExpiredGroundedResult(message, now))
    : messages;
}

/** Replaces grounding redirect links with their label, and drops bare ones. */
export function stripGroundingLinks(text: string): string {
  const pattern = GROUNDING_REDIRECT_URL.source;
  return text
    .replace(new RegExp(`\\[([^\\]]*)\\]\\(\\s*<?${pattern}>?\\s*\\)`, "gi"), "$1")
    .replace(new RegExp(pattern, "gi"), "");
}

export function containsGroundingLinks(text: string | undefined): boolean {
  return !!text && GROUNDING_REDIRECT_URL.test(text);
}

/**
 * The message as it may be written to disk. Search Suggestions never are; a Grounded Result
 * also loses its sources and any grounding redirect links in its text. A message that carries
 * Search Suggestions without a retention stamp is stamped here, so a host that forgot cannot
 * leak an unbounded Grounded Result.
 */
export function toPersistableMessage(message: Message): Message {
  const { searchSuggestions, ...rest } = message;
  const grounded = isGroundedResult(message) || searchSuggestions !== undefined;
  if (!grounded) return rest;
  const { webSearchSources: _sources, ...persisted } = rest;
  return {
    ...persisted,
    content: stripGroundingLinks(persisted.content),
    ...(persisted.llmContent !== undefined ? { llmContent: stripGroundingLinks(persisted.llmContent) } : {}),
    ...(persisted.thinking !== undefined ? { thinking: stripGroundingLinks(persisted.thinking) } : {}),
    webSearchUsed: true,
    grounding: persisted.grounding ?? createGroundingRetention(message.timestamp),
  };
}

/**
 * Decides whether a message saved before retention stamps existed was a Google Grounded Result.
 * The default is deliberately conservative: any recorded web search counts, and so does a reply
 * that carries a grounding redirect link even if the flag was never saved. Only answers that
 * identifiably came from another provider (its continuation state or model name) are left alone;
 * hosts can narrow it further.
 */
export type LegacyGroundingPredicate = (message: Message) => boolean;

/** Answers that identifiably came from another provider's web search, which these rules do not cover. */
const NON_GOOGLE_MODEL = /\b(gpt|chatgpt|o[1-9]|claude|grok|openai|anthropic|xai)\b/i;

export const isLegacyGoogleGroundedResult: LegacyGroundingPredicate = (message) =>
  message.role === "assistant"
  && message.providerContinuation === undefined
  && !NON_GOOGLE_MODEL.test(`${message.model ?? ""} ${message.modelDisplayName ?? ""}`)
  && (
    message.webSearchUsed === true
    || (message.webSearchSources?.length ?? 0) > 0
    || containsGroundingLinks(message.content)
    || containsGroundingLinks(message.llmContent)
  );

/**
 * Brings a loaded conversation in line with the retention rules: legacy Grounded Results get a
 * stamp dated from their original timestamp and lose their stored grounding metadata, then
 * expired ones are dropped. Idempotent — a second pass reports no change.
 */
export function normalizeGroundedMessages(
  messages: Message[],
  options: { now?: number; isLegacyGrounded?: LegacyGroundingPredicate } = {},
): { messages: Message[]; changed: boolean } {
  const now = options.now ?? Date.now();
  const isLegacy = options.isLegacyGrounded ?? isLegacyGoogleGroundedResult;
  let changed = false;
  const migrated = messages.map(message => {
    if (isGroundedResult(message)) {
      if (message.webSearchSources === undefined && message.searchSuggestions === undefined
        && !containsGroundingLinks(message.content) && !containsGroundingLinks(message.llmContent)
        && !containsGroundingLinks(message.thinking)) {
        return message;
      }
    } else if (!isLegacy(message)) {
      return message;
    }
    changed = true;
    return toPersistableMessage({
      ...message,
      grounding: message.grounding ?? createGroundingRetention(message.timestamp),
    });
  });
  const kept = withoutExpiredGroundedResults(migrated, now);
  return { messages: kept, changed: changed || kept !== migrated };
}

/** UTC day number, for "first use after the date changed" checks. */
export function groundingRetentionDay(now: number = Date.now()): number {
  return Math.floor(now / 86_400_000);
}
