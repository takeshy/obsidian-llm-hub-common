import { requestUrl } from "obsidian";
import type { WebSearchTransport } from "./externalWebSearch.js";

export interface CreditAllowance { used: number; limit: number | null; remaining: number | null }
export interface TavilyUsage {
  fetchedAt: number;
  plan: CreditAllowance;
  key?: CreditAllowance;
  paygo?: CreditAllowance;
}
export interface BraveRequestWindow {
  limit: number;
  remaining: number | null;
  windowSeconds: number;
  resetsAt?: number;
}
export interface BraveUsage { fetchedAt: number; windows: BraveRequestWindow[] }

// Device/runtime observations only. Nothing is saved into settings or model data.
const tavilyCache = new Map<string, TavilyUsage>();
const braveCache = new Map<string, BraveUsage>();
const listeners = new Set<() => void>();
export function subscribeWebSearchUsage(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function publish<T>(cache: Map<string, T>, key: string, value: T): void {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > 16) cache.delete(cache.keys().next().value!);
  for (const listener of listeners) {
    try { listener(); } catch { /* Observers must never fail a search request. */ }
  }
}
export function getTavilyUsage(apiKey: string): TavilyUsage | undefined { return tavilyCache.get(apiKey.trim()); }
export function getBraveUsage(apiKey: string): BraveUsage | undefined { return braveCache.get(apiKey.trim()); }

function count(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function allowance(used: unknown, limit: unknown): CreditAllowance | undefined {
  if (!count(used) || (limit !== null && !count(limit))) return undefined;
  return { used, limit, remaining: limit === null ? null : Math.max(0, limit - used) };
}
export function parseTavilyUsage(value: unknown, fetchedAt = Date.now()): TavilyUsage {
  const data = value as { account?: Record<string, unknown>; key?: Record<string, unknown> } | null;
  const plan = allowance(data?.account?.plan_usage, data?.account?.plan_limit);
  if (!plan) throw new Error("Invalid Tavily usage response.");
  return {
    fetchedAt, plan,
    key: allowance(data?.key?.usage, data?.key?.limit),
    paygo: allowance(data?.account?.paygo_usage, data?.account?.paygo_limit),
  };
}

/** Called only by the settings button; never runs an actual search. */
export async function fetchTavilyUsage(apiKey: string, transport: WebSearchTransport = requestUrl): Promise<TavilyUsage> {
  const key = apiKey.trim();
  if (!key) throw new Error("Tavily API key is not configured.");
  let response;
  try {
    response = await transport({ url: "https://api.tavily.com/usage", method: "GET", throw: false,
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
  } catch { throw new Error("Tavily usage request failed."); }
  if (response.status < 200 || response.status >= 300) throw new Error(`Tavily usage failed (HTTP ${response.status}).`);
  let usage: TavilyUsage;
  try { usage = parseTavilyUsage(response.json); }
  catch { throw new Error("Invalid Tavily usage response."); }
  publish(tavilyCache, key, usage);
  return usage;
}

function header(headers: Record<string, string>, name: string): string | undefined {
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
}
function numbers(value: string | undefined): number[] | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map(part => part.trim());
  if (parts.some(part => !/^\d+(?:\.\d+)?$/.test(part))) return undefined;
  const values = parts.map(Number);
  return values.every(count) ? values : undefined;
}
/** Match every remaining count to its declared window; never assume a monthly quota. */
export function parseBraveUsage(headers: Record<string, string>, fetchedAt = Date.now()): BraveUsage | undefined {
  const remaining = numbers(header(headers, "x-ratelimit-remaining"));
  const limits = numbers(header(headers, "x-ratelimit-limit"));
  const policy = header(headers, "x-ratelimit-policy")?.split(",").map(value => value.trim());
  const reset = numbers(header(headers, "x-ratelimit-reset"));
  if (!remaining || !limits || !policy || remaining.length !== limits.length || policy.length !== limits.length) return undefined;
  const windows: BraveRequestWindow[] = [];
  for (let index = 0; index < limits.length; index++) {
    const match = /^(\d+)\s*;\s*w=(\d+)\s*$/.exec(policy[index]);
    if (!match || Number(match[1]) !== limits[index] || Number(match[2]) <= 0) return undefined;
    windows.push({ limit: limits[index], remaining: limits[index] === 0 ? null : remaining[index],
      windowSeconds: Number(match[2]),
      ...(reset?.length === limits.length ? { resetsAt: fetchedAt + reset[index] * 1000 } : {}),
    });
  }
  return { fetchedAt, windows };
}

/** Observe headers from a real search, including quota errors. No extra paid request. */
export function recordBraveUsage(apiKey: string, headers?: Record<string, string>): void {
  if (!headers || !apiKey.trim()) return;
  const usage = parseBraveUsage(headers);
  if (usage) publish(braveCache, apiKey.trim(), usage);
}
