import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import { DEFAULT_WEB_SEARCH_SETTINGS, isWebSearchConfigured, searchWeb, createWebSearchSession, generateWithWebReferences } from "./externalWebSearch.js";

vi.mock("obsidian", () => ({ requestUrl: vi.fn() }));
const request = vi.mocked(requestUrl);
const tavily = { ...DEFAULT_WEB_SEARCH_SETTINGS, provider: "tavily" as const, tavilyApiKey: " tavily-secret " };
const brave = { ...DEFAULT_WEB_SEARCH_SETTINGS, provider: "brave" as const, braveApiKey: " brave-secret " };
beforeEach(() => { request.mockReset(); });

describe("Web search providers", () => {
  it("only enables the selected provider when its own key is present", async () => {
    expect(isWebSearchConfigured(tavily)).toBe(true);
    expect(isWebSearchConfigured(brave)).toBe(true);
    expect(isWebSearchConfigured({ ...tavily, provider: "brave" })).toBe(false);
    expect(isWebSearchConfigured({ ...tavily, provider: "none" })).toBe(false);
    await expect(searchWeb(DEFAULT_WEB_SEARCH_SETTINGS, "query")).rejects.toThrow("Configure");
    await expect(searchWeb(tavily, " ")).rejects.toThrow("non-empty");
    expect(request).not.toHaveBeenCalled();
  });
  it("uses Tavily basic search with no automatic depth escalation and bounded normalized results", async () => {
    request.mockResolvedValue({ status: 200, json: { results: [
      { title: "Bad URL", url: "javascript:alert(1)", content: "bad" },
      ...Array.from({ length: 8 }, (_, i) => ({ title: `Title ${i}`, url: `https://example.com/${i}`, content: "a".repeat(3000) })),
    ] } } as never);
    const results = await searchWeb(tavily, " query ");
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ url: "https://api.tavily.com/search", method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer tavily-secret" }) }));
    const options = request.mock.calls[0][0] as { body: string };
    expect(JSON.parse(options.body)).toEqual({ query: "query", max_results: 5, search_depth: "basic", auto_parameters: false,
      include_answer: false, include_raw_content: false });
    expect(results).toHaveLength(5);
    expect(results[0]).toEqual({ title: "Title 0", url: "https://example.com/0", snippet: "a".repeat(2000) });
  });
  it("uses only the Brave key and encodes the query", async () => {
    request.mockResolvedValue({ status: 200, json: { web: { results: [{ title: "Source", url: "https://example.com", description: "Snippet" }] } } } as never);
    expect(await searchWeb({ ...brave, tavilyApiKey: "unused" }, "日本 & AI")).toEqual([{ title: "Source", url: "https://example.com", snippet: "Snippet" }]);
    expect(request).toHaveBeenCalledWith({ url: `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent("日本 & AI")}&count=5`,
      method: "GET", throw: false, headers: { Accept: "application/json", "X-Subscription-Token": "brave-secret" } });
  });
  it("accepts an empty Brave web response as no results", async () => {
    request.mockResolvedValue({ status: 200, json: { type: "search", query: {} } } as never);
    expect(await searchWeb(brave, "no results")).toEqual([]);
  });
  it("reports provider failures without leaking credentials or retrying on another provider", async () => {
    request.mockResolvedValue({ status: 429, json: { error: "tavily-secret" } } as never);
    await expect(searchWeb(tavily, "query")).rejects.toThrow("HTTP 429");
    expect(request).toHaveBeenCalledOnce();
    request.mockRejectedValue(new Error("Authorization: brave-secret"));
    await expect(searchWeb(brave, "query")).rejects.toThrow(/^brave Web search request failed\.$/);
  });
  it("rejects malformed provider payloads", async () => {
    request.mockResolvedValue({ status: 200, json: { results: "bad" } } as never);
    await expect(searchWeb(tavily, "query")).rejects.toThrow("Invalid Web search response");
  });
});


describe("shared search sessions", () => {
  it("preserves caller tools, bounds attempts including failures, and snapshots the selected provider", async () => {
    request.mockResolvedValue({ status: 429, json: {} } as never);
    const settings = { ...tavily };
    const execute = vi.fn().mockResolvedValue({ ok: true });
    const session = createWebSearchSession({ settings, maxCalls: 1 }, [{ name: "read", description: "read", parameters: { type: "object", properties: {} } }], "prompt", execute);
    settings.provider = "brave" as "tavily";
    expect(session.tools.map(tool => tool.name)).toEqual(["read", "web_search"]);
    expect(await session.execute("read", {})).toEqual({ ok: true });
    expect(await session.execute("web_search", { query: "q" })).toEqual({ error: "tavily Web search failed (HTTP 429)." });
    expect(await session.execute("web_search", { query: "q" })).toEqual({ error: expect.stringContaining("limit reached") });
    expect(request).toHaveBeenCalledOnce();
  });
  it("deduplicates sources and records successful searches only when they execute", async () => {
    request.mockResolvedValue({ status: 200, json: { results: [{ title: "Source", url: "https://example.com", content: "facts" }] } } as never);
    const session = createWebSearchSession({ settings: tavily }, []);
    async function* stream() {
      await session.execute("web_search", { query: "one" });
      yield { type: "tool_result" as const };
      await session.execute("web_search", { query: "two" });
      yield { type: "done" as const, usage: { totalTokens: 10 } };
    }
    const chunks = [];
    for await (const chunk of session.wrap(stream())) chunks.push(chunk);
    expect(chunks.filter(chunk => chunk.type === "web_search_used")).toHaveLength(1);
    expect(chunks.at(-1)).toMatchObject({ webSearchSources: [{ title: "Source", url: "https://example.com" }], usage: { totalTokens: 10, webSearchRequests: 2 } });
  });
  it("retains reference-model usage and emits only one completion for image generation", async () => {
    async function* search() {
      yield { type: "web_search_used" as const };
      yield { type: "text" as const, content: "reference facts" };
      yield { type: "done" as const, usage: { totalTokens: 7, webSearchRequests: 1 }, webSearchSources: [{ title: "Source", url: "https://example.com" }] };
    }
    const generate = vi.fn(async function* (_prompt: string) { yield { type: "done" as const, usage: { totalTokens: 11 } }; });
    const chunks = [];
    for await (const chunk of generateWithWebReferences({ search, generate })) chunks.push(chunk);
    expect(generate.mock.calls[0][0]).toContain("reference facts");
    expect(chunks.filter(chunk => chunk.type === "done")).toHaveLength(1);
    expect(chunks.at(-1)).toMatchObject({ usage: { totalTokens: 18, webSearchRequests: 1 }, webSearchSources: [{ title: "Source", url: "https://example.com" }] });
  });
});
