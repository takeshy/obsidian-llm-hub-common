import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import { fetchTavilyUsage, getTavilyUsage, getBraveUsage, parseTavilyUsage, parseBraveUsage, recordBraveUsage, subscribeWebSearchUsage } from "./webSearchUsage.js";
import { searchWeb } from "./externalWebSearch.js";
vi.mock("obsidian", () => ({ requestUrl: vi.fn() }));
const request = vi.mocked(requestUrl);
const payload = { key: { usage: 150, limit: null }, account: { plan_usage: 500, plan_limit: 15000, paygo_usage: 25, paygo_limit: 100 } };
const headers = {
  "X-RateLimit-Limit": "1, 15000", "X-RateLimit-Remaining": "0, 12000",
  "X-RateLimit-Policy": "1;w=1, 15000;w=2592000", "X-RateLimit-Reset": "1, 3600",
};
beforeEach(() => { request.mockReset(); });

describe("Tavily account usage", () => {
  it("separates plan, key and pay-as-you-go limits without adding them together", () => {
    expect(parseTavilyUsage(payload, 100)).toEqual({ fetchedAt: 100,
      plan: { used: 500, limit: 15000, remaining: 14500 }, key: { used: 150, limit: null, remaining: null },
      paygo: { used: 25, limit: 100, remaining: 75 } });
    expect(parseTavilyUsage({ account: { plan_usage: 1200, plan_limit: 1000 } }).plan.remaining).toBe(0);
    expect(() => parseTavilyUsage({ account: { plan_limit: 1000 } })).toThrow("Invalid");
    expect(() => parseTavilyUsage({ account: { plan_usage: 10, plan_limit: -1 } })).toThrow("Invalid");
  });
  it("fetches only the usage endpoint with the clicked key and isolates cache entries", async () => {
    request.mockResolvedValue({ status: 200, json: payload } as never);
    const listener = vi.fn(); const dispose = subscribeWebSearchUsage(listener);
    const usage = await fetchTavilyUsage(" account-key ");
    expect(request).toHaveBeenCalledWith({ url: "https://api.tavily.com/usage", method: "GET", throw: false,
      headers: { Authorization: "Bearer account-key", Accept: "application/json" } });
    expect(getTavilyUsage("account-key")).toEqual(usage);
    expect(getTavilyUsage("different-key")).toBeUndefined();
    expect(listener).toHaveBeenCalledOnce();
    dispose();
  });
  it("does not request missing keys and sanitizes authentication, transport and JSON errors", async () => {
    await expect(fetchTavilyUsage(" ")).rejects.toThrow("not configured");
    expect(request).not.toHaveBeenCalled();
    request.mockResolvedValue({ status: 401, json: { message: "private-key" } } as never);
    await expect(fetchTavilyUsage("private-key")).rejects.toThrow("HTTP 401");
    request.mockRejectedValue(new Error("private-key in transport"));
    await expect(fetchTavilyUsage("private-key")).rejects.toThrow(/^Tavily usage request failed\.$/);
    request.mockResolvedValue({ status: 200, json: {} } as never);
    await expect(fetchTavilyUsage("private-key")).rejects.toThrow("Invalid Tavily");
    expect(getTavilyUsage("private-key")).toBeUndefined();
  });
});

describe("Brave request quota", () => {
  it("matches remaining counts to their own windows and keeps exact zero", () => {
    expect(parseBraveUsage(headers, 1000)).toEqual({ fetchedAt: 1000, windows: [
      { limit: 1, remaining: 0, windowSeconds: 1, resetsAt: 2000 },
      { limit: 15000, remaining: 12000, windowSeconds: 2592000, resetsAt: 3601000 },
    ] });
    expect(parseBraveUsage({ ...headers, "X-RateLimit-Remaining": "0, 0" })?.windows[1].remaining).toBe(0);
    expect(parseBraveUsage({ "x-ratelimit-limit": "0", "x-ratelimit-remaining": "0", "x-ratelimit-policy": "0;w=86400" })?.windows[0].remaining).toBeNull();
  });
  it("ignores absent, malformed and misaligned headers instead of inventing a monthly quota", () => {
    expect(parseBraveUsage({})).toBeUndefined();
    expect(parseBraveUsage({ ...headers, "X-RateLimit-Remaining": "1" })).toBeUndefined();
    expect(parseBraveUsage({ ...headers, "X-RateLimit-Remaining": "1, NaN" })).toBeUndefined();
    expect(parseBraveUsage({ ...headers, "X-RateLimit-Policy": "1;w=1, 123;w=2592000" })).toBeUndefined();
    expect(parseBraveUsage({ ...headers, "X-RateLimit-Policy": "1;w=1, 15000" })).toBeUndefined();
  });
  it("observes real search headers without extra HTTP calls or changing model results", async () => {
    request.mockResolvedValue({ status: 200, headers, json: { web: { results: [] } } } as never);
    expect(await searchWeb({ provider: "brave", braveApiKey: "brave-observer", tavilyApiKey: "" }, "query")).toEqual([]);
    expect(getBraveUsage("brave-observer")?.windows[1].remaining).toBe(12000);
    expect(getBraveUsage("other-key")).toBeUndefined();
    expect(request).toHaveBeenCalledOnce();
  });
  it("can update quota on HTTP 429 while observer failures never fail searches", async () => {
    const dispose = subscribeWebSearchUsage(() => { throw new Error("UI removed"); });
    request.mockResolvedValue({ status: 429, headers, json: {} } as never);
    await expect(searchWeb({ provider: "brave", braveApiKey: "brave-limited", tavilyApiKey: "" }, "query")).rejects.toThrow("HTTP 429");
    expect(getBraveUsage("brave-limited")).toBeDefined();
    dispose();
    recordBraveUsage("", headers);
    expect(getBraveUsage("")).toBeUndefined();
  });
});
