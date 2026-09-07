import type { WebSearchSource } from "./message.js";

/** Normalize function results that Gemini rejects, such as empty arrays. */
export function sanitizeGeminiFunctionResult(value: unknown): unknown {
  return sanitizeGeminiFunctionResultValue(value, new WeakSet<object>());
}

function sanitizeGeminiFunctionResultValue(value: unknown, ancestors: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (ancestors.has(value)) throw new TypeError("Circular Gemini function result");
    ancestors.add(value);
    const result = value.map(nested => sanitizeGeminiFunctionResultValue(nested, ancestors));
    ancestors.delete(value);
    return result;
  }
  if (typeof value === "object") {
    if (ancestors.has(value)) throw new TypeError("Circular Gemini function result");
    ancestors.add(value);
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      result[key] = sanitizeGeminiFunctionResultValue(nested, ancestors);
    }
    ancestors.delete(value);
    return result;
  }
  return value;
}

/** Serialize a function result without leaking invalid or unserializable values. */
export function serializeGeminiFunctionResult(value: unknown): string {
  try {
    const sanitized = sanitizeGeminiFunctionResult(value);
    if (typeof sanitized === "string") return sanitized || "null";
    return JSON.stringify(sanitized) || "null";
  } catch {
    return "null";
  }
}

export interface PreparedGeminiToolResult {
  serializedResult: string;
  trace: string;
}

export function prepareGeminiToolResult(
  name: string,
  args: Record<string, unknown>,
  result: unknown,
  traceResultLimit = 500,
): PreparedGeminiToolResult {
  const serializedResult = serializeGeminiFunctionResult(result);
  const traceResult = serializedResult.length > traceResultLimit
    ? serializedResult.slice(0, traceResultLimit) + "..."
    : serializedResult;
  return {
    serializedResult,
    trace: `\n[tool_call: ${name}(${JSON.stringify(args)})]\n[tool_result: ${traceResult}]\n`,
  };
}

/** Collect unique HTTP(S) sources from Gemini tool responses and attribution HTML. */
export function collectGeminiWebSources(value: unknown, sources: WebSearchSource[]): void {
  if (typeof value === "string") {
    const anchorPattern = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    for (const match of value.matchAll(anchorPattern)) {
      const url = match[1].replace(/&amp;/g, "&");
      const title = match[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() || url;
      if (/^https?:\/\//i.test(url) && !sources.some(source => source.url === url)) {
        sources.push({ title, url });
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectGeminiWebSources(item, sources);
    return;
  }
  if (!value || typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  const rawUrl = [record.url, record.uri, record.link].find(candidate => typeof candidate === "string");
  if (typeof rawUrl === "string" && /^https?:\/\//i.test(rawUrl)) {
    const rawTitle = [record.title, record.name].find(candidate => typeof candidate === "string");
    if (!sources.some(source => source.url === rawUrl)) {
      sources.push({ title: typeof rawTitle === "string" ? rawTitle : rawUrl, url: rawUrl });
    }
  }

  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") collectGeminiWebSources(nested, sources);
  }
}
