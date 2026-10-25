import { describe, expect, it } from "vitest";
import type { Message } from "./message.js";
import {
  createGroundingRetention,
  groundingExpiresAt,
  isLegacyGoogleGroundedResult,
  normalizeGroundedMessages,
  stripGroundingLinks,
  toPersistableMessage,
  withoutExpiredGroundedResults,
} from "./grounding.js";
import { generateKeyPair, encryptPrivateKey, decryptFileContent } from "./crypto.js";
import { messagesToCompactMarkdown, messagesToMarkdown, parseMarkdownToMessages } from "../chat/chatHistory.js";
import { accumulateStreamChunk, createStreamAccumulation, webSearchMessageFields } from "../chat/streamAccumulator.js";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 26);
const REDIRECT = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC123";
const SUGGESTIONS = "<style>.chip{}</style><a class=\"chip\" href=\"https://www.google.com/search?q=x\">x</a>";

function grounded(timestamp: number, extra: Partial<Message> = {}): Message {
  return {
    role: "assistant",
    content: `Grounded answer [source](${REDIRECT})`,
    timestamp,
    model: "gemini-3-flash",
    webSearchUsed: true,
    webSearchSources: [{ title: "Source", url: REDIRECT }],
    searchSuggestions: SUGGESTIONS,
    grounding: createGroundingRetention(timestamp),
    ...extra,
  };
}

describe("grounding retention", () => {
  it("expires two calendar years after the answer was shown", () => {
    expect(groundingExpiresAt(Date.UTC(2026, 9, 26, 12))).toBe(Date.UTC(2028, 9, 26, 12));
    expect(createGroundingRetention(5)).toEqual({ provider: "google_search", displayedAt: 5, expiresAt: groundingExpiresAt(5) });
  });

  it("keeps results younger than two years and drops only expired grounded ones (T06-T08)", () => {
    const user: Message = { role: "user", content: "q", timestamp: NOW - 800 * DAY };
    const plain: Message = { role: "assistant", content: "plain", timestamp: NOW - 800 * DAY };
    const fresh = grounded(NOW - 700 * DAY);
    const expired = grounded(NOW - 731 * DAY);
    const messages = [user, plain, expired, fresh];
    expect(withoutExpiredGroundedResults(messages, NOW)).toEqual([user, plain, fresh]);
    const unchanged = [user, plain, fresh];
    expect(withoutExpiredGroundedResults(unchanged, NOW)).toBe(unchanged);
  });

  it("replaces grounding redirect links with their label", () => {
    expect(stripGroundingLinks(`See [Example](${REDIRECT}) or ${REDIRECT} and [kept](https://example.com)`))
      .toBe("See Example or  and [kept](https://example.com)");
  });

  it("never persists suggestions, grounding sources or redirect links", () => {
    const persisted = toPersistableMessage(grounded(NOW));
    expect(persisted).not.toHaveProperty("searchSuggestions");
    expect(persisted).not.toHaveProperty("webSearchSources");
    expect(persisted.content).toBe("Grounded answer source");
    expect(persisted.webSearchUsed).toBe(true);
    expect(persisted.grounding?.displayedAt).toBe(NOW);
  });

  it("stamps a message that carries suggestions even when the host forgot to", () => {
    const { grounding: _grounding, ...unstamped } = grounded(NOW);
    expect(toPersistableMessage(unstamped).grounding).toEqual(createGroundingRetention(NOW));
  });

  it("leaves other providers' web search sources alone", () => {
    const openAi: Message = { role: "assistant", content: "a", timestamp: 1, webSearchUsed: true,
      webSearchSources: [{ title: "t", url: "https://example.com" }] };
    expect(toPersistableMessage(openAi)).toEqual(openAi);
  });
});

describe("grounded history serialization (T04, T05)", () => {
  it("writes only webSearchUsed and the retention stamp, and reads the answer back", async () => {
    const md = await messagesToMarkdown([{ role: "user", content: "q", timestamp: NOW }, grounded(NOW)], "t", NOW, undefined);
    expect(md).not.toContain(REDIRECT);
    expect(md).not.toContain("webSearchSources");
    expect(md).not.toContain("google.com/search");
    expect(md).not.toContain("chip");
    const parsed = parseMarkdownToMessages(md)!;
    expect(parsed.messages[1]).toMatchObject({
      content: "Grounded answer source",
      webSearchUsed: true,
      grounding: createGroundingRetention(NOW),
    });
    expect(parsed.messages[1].webSearchSources).toBeUndefined();
  });

  it("applies the same restriction to encrypted history (T10)", async () => {
    const { publicKey, privateKey } = await generateKeyPair();
    const { encryptedPrivateKey, salt } = await encryptPrivateKey(privateKey, "pw");
    const md = await messagesToMarkdown([grounded(NOW)], "t", NOW, { encryptChatHistory: true, publicKey, encryptedPrivateKey, salt });
    const plain = await decryptFileContent(md, "pw");
    expect(plain).not.toContain(REDIRECT);
    expect(plain).not.toContain("chip");
    expect(parseMarkdownToMessages(plain)!.messages[0].grounding).toEqual(createGroundingRetention(NOW));
  });

  it("keeps grounded answers out of a whole-chat note export (T11)", () => {
    const note = messagesToCompactMarkdown([{ role: "user", content: "question", timestamp: NOW }, grounded(NOW),
      { role: "assistant", content: "plain answer", timestamp: NOW }]);
    expect(note).toContain("question");
    expect(note).toContain("plain answer");
    expect(note).not.toContain("Grounded answer");
  });
});

describe("legacy history migration (T09, T13)", () => {
  const legacy: Message = {
    role: "assistant", content: `Old [s](${REDIRECT})`, timestamp: NOW - 100 * DAY, model: "gemini-2.5-flash",
    webSearchUsed: true, webSearchSources: [{ title: "s", url: REDIRECT }],
  };
  const user: Message = { role: "user", content: "q", timestamp: NOW - 100 * DAY };

  it("strips stored grounding metadata and dates the stamp from the original message", () => {
    const { messages, changed } = normalizeGroundedMessages([user, legacy], { now: NOW });
    expect(changed).toBe(true);
    expect(messages[0]).toBe(user);
    expect(messages[1]).toMatchObject({ content: "Old s", grounding: createGroundingRetention(legacy.timestamp) });
    expect(messages[1].webSearchSources).toBeUndefined();
  });

  it("is idempotent", () => {
    const once = normalizeGroundedMessages([user, legacy], { now: NOW }).messages;
    const twice = normalizeGroundedMessages(once, { now: NOW });
    expect(twice.changed).toBe(false);
    expect(twice.messages).toEqual(once);
  });

  it("drops legacy results already past retention", () => {
    const old = { ...legacy, timestamp: NOW - 800 * DAY };
    expect(normalizeGroundedMessages([user, old], { now: NOW }).messages).toEqual([user]);
  });

  it("treats an unflagged answer with grounding links as grounded, but leaves identifiable other providers alone", () => {
    expect(isLegacyGoogleGroundedResult({ role: "assistant", content: `x ${REDIRECT}`, timestamp: 1 })).toBe(true);
    expect(isLegacyGoogleGroundedResult({ role: "assistant", content: "x", timestamp: 1, webSearchUsed: true, model: "gpt-5" })).toBe(false);
    expect(isLegacyGoogleGroundedResult({ role: "assistant", content: "x", timestamp: 1, webSearchUsed: true,
      providerContinuation: { provider: "anthropic", baseUrl: "", model: "", items: [] } })).toBe(false);
    expect(isLegacyGoogleGroundedResult({ role: "assistant", content: "x", timestamp: 1 })).toBe(false);
  });
});

describe("stream accumulation of Search Suggestions", () => {
  it("keeps the last suggestions and stamps the message as a Google Grounded Result", () => {
    const acc = createStreamAccumulation();
    accumulateStreamChunk(acc, { type: "web_search_used", groundingProvider: "google_search" });
    accumulateStreamChunk(acc, { type: "search_suggestions", renderedContent: "first" });
    accumulateStreamChunk(acc, { type: "search_suggestions", renderedContent: "last" });
    expect(webSearchMessageFields(acc, NOW)).toEqual({
      webSearchUsed: true,
      searchSuggestions: "last",
      grounding: createGroundingRetention(NOW),
    });
  });

  it("does not stamp other providers' web search or plain answers", () => {
    const acc = createStreamAccumulation();
    expect(webSearchMessageFields(acc)).toEqual({});
    accumulateStreamChunk(acc, { type: "web_search_used" });
    expect(webSearchMessageFields(acc)).toEqual({ webSearchUsed: true });
  });
});
