/**
 * Asking a server which models it has, and telling chat models apart from
 * embedding-only ones.
 *
 * The request itself is the caller's: one plugin routes it through a configured
 * proxy, another goes straight out through Obsidian. Everything around it — the
 * URLs, the shapes that come back and which names count as embedding models —
 * is the same everywhere and lives here.
 */

/** Performs a GET and returns the parsed JSON body. Throws if the server cannot be reached. */
export type ModelListGet = (url: string, headers: Record<string, string>) => Promise<unknown>;

export interface ModelServerTarget {
  baseUrl: string;
  apiKey?: string;
  /** The server software, when the user has declared it. */
  framework?: string;
}

/** Ollama model families that only produce embeddings. */
export const EMBEDDING_FAMILIES = new Set(["nomic-bert", "bert", "snowflake-arctic-embed"]);

/** Name patterns that mark an embedding-only model. */
export const EMBEDDING_NAME_PATTERN = /embed|bge-|e5-|gte-|arctic-embed/i;

export function isEmbeddingFamily(families?: string[]): boolean {
  return (families ?? []).some(family => EMBEDDING_FAMILIES.has(family));
}

export function isEmbeddingModelName(name: string): boolean {
  return EMBEDDING_NAME_PATTERN.test(name);
}

/**
 * Strip a trailing slash and a trailing `/v1`, so a base URL the user pasted
 * from an OpenAI-compatible setup does not end up as `/v1/v1/models`, and point
 * a bare openrouter.ai at its API host.
 */
export function normalizeServerBaseUrl(url: string): string {
  const base = url.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
  return /^https?:\/\/openrouter\.ai$/i.test(base) ? `${base}/api` : base;
}

/** AnythingLLM serves the OpenAI-compatible API one level deeper than everyone else. */
export function openaiPathPrefix(framework?: string): string {
  return framework === "anythingllm" ? "/v1/openai" : "/v1";
}

export function authHeaders(apiKey?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

interface OllamaTag {
  name: string;
  families?: string[];
}

/** Read Ollama's `/api/tags` body, or null if this is not an Ollama server. */
export function parseOllamaTags(json: unknown): OllamaTag[] | null {
  const models = (json as { models?: { name?: unknown; details?: { families?: unknown } }[] } | null)?.models;
  if (!Array.isArray(models)) return null;
  return models
    .filter((model): model is { name: string; details?: { families?: string[] } } => typeof model?.name === "string")
    .map(model => ({ name: model.name, families: model.details?.families }));
}

/** Read an OpenAI-compatible `/v1/models` body. */
export function parseOpenAiModels(json: unknown): string[] {
  const data = (json as { data?: { id?: unknown }[] } | null)?.data;
  if (!Array.isArray(data)) return [];
  return data.filter((model): model is { id: string } => typeof model?.id === "string").map(model => model.id);
}

/**
 * The models a server offers for chat.
 *
 * Ollama is asked through `/api/tags`, which is the only listing that carries
 * the model family and so the only one that can tell an embedding model apart
 * from a chat model by more than its name.
 */
export async function fetchChatModels(target: ModelServerTarget, get: ModelListGet): Promise<string[]> {
  const base = target.baseUrl.replace(/\/+$/, "");
  if (target.framework === "ollama") {
    const tags = parseOllamaTags(await get(`${base}/api/tags`, {}));
    return (tags ?? [])
      .filter(model => !isEmbeddingFamily(model.families) && !isEmbeddingModelName(model.name))
      .map(model => model.name);
  }
  const url = `${base}${openaiPathPrefix(target.framework)}/models`;
  return parseOpenAiModels(await get(url, authHeaders(target.apiKey))).filter(id => !isEmbeddingModelName(id));
}

/**
 * The models a server offers for embeddings.
 *
 * Ollama is tried first whatever the user declared: an Ollama server on another
 * host or a non-default port is otherwise indistinguishable from an
 * OpenAI-compatible one, and asking it as if it were one lists chat models it
 * cannot embed with.
 */
export async function fetchEmbeddingModels(target: ModelServerTarget, get: ModelListGet): Promise<string[]> {
  const base = normalizeServerBaseUrl(target.baseUrl);
  try {
    const tags = parseOllamaTags(await get(`${base}/api/tags`, {}));
    if (tags) {
      return tags
        .filter(model => isEmbeddingFamily(model.families) || isEmbeddingModelName(model.name))
        .map(model => model.name);
    }
  } catch {
    // Not an Ollama server — ask the OpenAI-compatible listing instead.
  }

  const headers = authHeaders(target.apiKey);
  // OpenRouter keeps its embedding models on an endpoint of their own, already
  // filtered, so the name test would only throw away valid entries.
  if (base.includes("openrouter.ai")) {
    return parseOpenAiModels(await get(`${base}/v1/embeddings/models`, headers));
  }
  const url = `${base}${openaiPathPrefix(target.framework)}/models`;
  return parseOpenAiModels(await get(url, headers)).filter(isEmbeddingModelName);
}
