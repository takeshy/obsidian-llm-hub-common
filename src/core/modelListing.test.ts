import { describe, expect, it, vi } from "vitest";
import {
  fetchChatModels,
  fetchEmbeddingModels,
  isEmbeddingModelName,
  normalizeServerBaseUrl,
  openaiPathPrefix,
  parseOllamaTags,
  parseOpenAiModels,
} from "./modelListing.js";

const ollamaTags = {
  models: [
    { name: "qwen3:8b", details: { families: ["qwen3"] } },
    { name: "nomic-embed-text:latest", details: { families: ["nomic-bert"] } },
    { name: "qwen3-embedding:8b-q8_0", details: { families: ["qwen3"] } },
  ],
};

const openAiModels = { data: [{ id: "gpt-oss-20b" }, { id: "text-embedding-nomic-v1.5" }] };

/** A server that answers the URLs it knows and refuses everything else. */
function server(routes: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    if (!(url in routes)) throw new Error(`no route: ${url}`);
    return routes[url];
  });
}

describe("normalizeServerBaseUrl", () => {
  it("does not let a pasted /v1 base URL become /v1/v1", () => {
    expect(normalizeServerBaseUrl("http://localhost:1234/v1")).toBe("http://localhost:1234");
    expect(normalizeServerBaseUrl("http://localhost:1234/")).toBe("http://localhost:1234");
  });

  it("points a bare openrouter.ai at its API host", () => {
    expect(normalizeServerBaseUrl("https://openrouter.ai")).toBe("https://openrouter.ai/api");
  });
});

describe("openaiPathPrefix", () => {
  it("serves AnythingLLM one level deeper", () => {
    expect(openaiPathPrefix("anythingllm")).toBe("/v1/openai");
    expect(openaiPathPrefix("lmstudio")).toBe("/v1");
    expect(openaiPathPrefix()).toBe("/v1");
  });
});

describe("parsing", () => {
  it("reads the two listing shapes", () => {
    expect(parseOllamaTags(ollamaTags)).toEqual([
      { name: "qwen3:8b", families: ["qwen3"] },
      { name: "nomic-embed-text:latest", families: ["nomic-bert"] },
      { name: "qwen3-embedding:8b-q8_0", families: ["qwen3"] },
    ]);
    expect(parseOpenAiModels(openAiModels)).toEqual(["gpt-oss-20b", "text-embedding-nomic-v1.5"]);
  });

  it("says a body is not an Ollama listing rather than inventing an empty one", () => {
    // The difference decides whether the embedding lookup falls through to the
    // OpenAI-compatible endpoint, so it cannot be flattened to [].
    expect(parseOllamaTags(openAiModels)).toBeNull();
    expect(parseOllamaTags(null)).toBeNull();
    expect(parseOpenAiModels({})).toEqual([]);
  });

  it("recognises an embedding model by name", () => {
    for (const name of ["nomic-embed-text", "bge-m3", "multilingual-e5-large", "gte-base", "arctic-embed"]) {
      expect(isEmbeddingModelName(name)).toBe(true);
    }
    expect(isEmbeddingModelName("qwen3:8b")).toBe(false);
  });
});

describe("fetchChatModels", () => {
  it("leaves out the embedding models Ollama reports", () => {
    const get = server({ "http://localhost:11434/api/tags": ollamaTags });
    return expect(fetchChatModels({ baseUrl: "http://localhost:11434", framework: "ollama" }, get))
      .resolves.toEqual(["qwen3:8b"]);
  });

  it("asks AnythingLLM on its own path and sends the key", async () => {
    const get = server({ "http://localhost:3001/v1/openai/models": openAiModels });

    await expect(fetchChatModels(
      { baseUrl: "http://localhost:3001", framework: "anythingllm", apiKey: "k" },
      get,
    )).resolves.toEqual(["gpt-oss-20b"]);
    expect(get).toHaveBeenCalledWith(
      "http://localhost:3001/v1/openai/models",
      expect.objectContaining({ Authorization: "Bearer k" }),
    );
  });

  it("sends no Authorization header when there is no key", async () => {
    const get = server({ "http://localhost:1234/v1/models": openAiModels });
    await fetchChatModels({ baseUrl: "http://localhost:1234" }, get);
    expect(get.mock.calls[0][1]).toEqual({ "Content-Type": "application/json" });
  });
});

describe("fetchEmbeddingModels", () => {
  it("finds an Ollama server that was never declared as one", async () => {
    // A remote Ollama, or one on another port, is indistinguishable from an
    // OpenAI-compatible server until /api/tags answers.
    const get = server({ "http://ollama.lan:9000/api/tags": ollamaTags });

    await expect(fetchEmbeddingModels({ baseUrl: "http://ollama.lan:9000" }, get))
      .resolves.toEqual(["nomic-embed-text:latest", "qwen3-embedding:8b-q8_0"]);
  });

  it("falls through to the OpenAI listing when that is not Ollama", async () => {
    const get = server({ "http://localhost:1234/v1/models": openAiModels });

    await expect(fetchEmbeddingModels({ baseUrl: "http://localhost:1234/v1" }, get))
      .resolves.toEqual(["text-embedding-nomic-v1.5"]);
  });

  it("takes OpenRouter's embedding endpoint as it comes", async () => {
    // That endpoint is already only embedding models, and their names do not
    // all say so.
    const get = server({
      "https://openrouter.ai/api/v1/embeddings/models": { data: [{ id: "qwen/qwen3-8b" }] },
    });

    await expect(fetchEmbeddingModels({ baseUrl: "https://openrouter.ai" }, get))
      .resolves.toEqual(["qwen/qwen3-8b"]);
  });
});
