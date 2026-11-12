import { describe, it, expect, vi } from "vitest";
import { Bm25Index } from "./bm25.js";
import { ChunkBm25Index } from "./chunkBm25Index.js";
import { createSearchTokenizer } from "./searchTokenizer.js";
import { collectHybridCandidates, normalizeHybridSearchOptions, reciprocalRankFusion } from "./hybridSearch.js";

describe("search tokenization", () => {
  it("normalizes English, punctuation, case and whole identifiers", () => {
    const tokens = createSearchTokenizer().tokenize("Deploy PRJ-123, snake_case! ＡＰＩ user@example.com");
    expect(tokens).toEqual(["deploy", "prj-123", "prj", "123", "snake_case", "snake", "case", "api", "user", "example", "com"]);
  });

  it.each([false, true])("uses the same Japanese and mixed tokenization for documents and queries (bigrams: %s)", fallback => {
    const tokenizer = createSearchTokenizer(fallback);
    const query = tokenizer.tokenize("東京都 検索PRJ-123 API");
    const document = tokenizer.tokenize("東京都の検索PRJ-123 APIについて");
    expect(query).toContain("prj-123");
    expect(query).toContain("api");
    expect(query.filter(t => /[\u3000-\u9fff]/.test(t)).length).toBeGreaterThan(0);
    expect(query.every(t => document.includes(t))).toBe(true);
  });

  it("falls back when Intl.Segmenter is unavailable and handles supplementary characters", () => {
    const saved = Object.getOwnPropertyDescriptor(Intl, "Segmenter");
    Object.defineProperty(Intl, "Segmenter", { value: undefined, configurable: true });
    try {
      const tokenizer = createSearchTokenizer();
      expect(tokenizer.id).toBe("cjk-bigram-v1");
      expect(tokenizer.tokenize("東京都 日本語 𠮷野家 京")).toEqual(["東京", "京都", "日本", "本語", "𠮷野", "野家", "京"]);
    } finally { if (saved) Object.defineProperty(Intl, "Segmenter", saved); }
  });

  it("tokenizes Chinese and Korean runs with overlapping bigrams", () => {
    expect(createSearchTokenizer(true).tokenize("中文测试 한국어"))
      .toEqual(["中文", "文测", "测试", "한국", "국어"]);
  });
});

describe("BM25", () => {
  const doc = (id: string, text: string) => ({ id, text, revision: text });
  it("matches the BM25 formula, document lengths and positive IDF", () => {
    const index = new Bm25Index();
    index.update([doc("a", "term term other"), doc("b", "other")]);
    expect(index.averageLength).toBe(2);
    expect(index.search("term term", 10)).toEqual([
      { id: "a", score: Math.log(2) * 2 * 2.2 / (2 + 1.2 * (0.25 + 0.75 * 3 / 2)) },
    ]);
    expect(index.search("other", 10).every(r => r.score > 0)).toBe(true);
    expect(index.search("missing", 10)).toEqual([]);
  });

  it("updates additions, changes and deletions without retokenizing unchanged documents", () => {
    const tokenizer = createSearchTokenizer();
    const tokenize = vi.spyOn(tokenizer, "tokenize");
    const index = new Bm25Index(tokenizer);
    index.update([doc("a", "alpha"), doc("b", "beta")]);
    tokenize.mockClear();
    index.update([doc("a", "alpha"), doc("b", "updated"), doc("c", "gamma")]);
    expect(tokenize.mock.calls.map(([text]) => text)).toEqual(["updated", "gamma"]);
    expect(index.search("beta", 10)).toEqual([]);
    index.update([doc("a", "alpha"), doc("c", "gamma")]);
    expect(index.search("updated", 10)).toEqual([]);
    expect(index.size).toBe(2);
    expect(index.averageLength).toBe(1);
    index.update([]);
    expect(index.averageLength).toBe(0);
    expect(index.search("alpha", 10)).toEqual([]);
  });

  it("round trips a compact snapshot and validates versions, tokenizer and corruption", () => {
    const index = new Bm25Index();
    index.update([doc("a", "term term other"), doc("b", "other")]);
    const snapshot = JSON.parse(JSON.stringify(index.serialize()));
    const restored = Bm25Index.deserialize(snapshot)!;
    expect(restored.search("term other", 10)).toEqual(index.search("term other", 10));
    restored.update([doc("b", "changed")]);
    expect(restored.search("term", 10)).toEqual([]);
    expect(Bm25Index.deserialize({ ...snapshot, version: 0 })).toBeNull();
    expect(Bm25Index.deserialize({ ...snapshot, tokenizer: "old-mode" })).toBeNull();
    expect(Bm25Index.deserialize({ ...snapshot, postings: [["term", [999, 2]]] })).toBeNull();
    expect(Bm25Index.deserialize({ ...snapshot, postings: [] })).toBeNull();
    expect(Bm25Index.deserialize(null)).toBeNull();
  });

  it("filters the corpus before taking the candidate limit", () => {
    const index = new Bm25Index();
    index.update([doc("a", "term"), doc("b", "term filler")]);
    expect(index.search("term", 1, id => id === "b").map(r => r.id)).toEqual(["b"]);
  });
});

describe("chunk BM25 cache", () => {
  const a = { filePath: "a.md", chunkIndex: 0, text: "alpha" };
  const b = { filePath: "b.md", startOffset: 0, text: "beta" };
  it("rebuilds absent and obsolete caches from text, and repairs stale corpus revisions", () => {
    const cache = new ChunkBm25Index([a, b], { version: 0 });
    expect(cache.search("alpha", 5)[0].id).toBe("0");
    const restored = new ChunkBm25Index([b, { ...a, text: "gamma" }], cache.serialize());
    expect(restored.search("beta", 5)[0].id).toBe("0");
    expect(restored.search("gamma", 5)[0].id).toBe("1");
    expect(restored.search("alpha", 5)).toEqual([]);
  });

  it("keeps duplicates from combined/external sources distinct and survives reorder/deletion", () => {
    const cache = new ChunkBm25Index([a, a, b]);
    expect(cache.search("alpha", 5).map(r => r.id).sort()).toEqual(["0", "1"]);
    cache.update([b, a]);
    expect(cache.search("alpha", 5).map(r => r.id)).toEqual(["1"]);
    expect(cache.search("beta", 5).map(r => r.id)).toEqual(["0"]);
  });
});

describe("reciprocal rank fusion", () => {
  it("uses 1-based ranks and promotes a candidate present in both lists", () => {
    const result = reciprocalRankFusion([
      [{ id: "vector", score: 1 }, { id: "both", score: 0.5 }],
      [{ id: "lexical", score: 900 }, { id: "both", score: 1 }],
    ]);
    expect(result.map(r => r.id)).toEqual(["both", "vector", "lexical"]);
    expect(result[0].score).toBe(2 / 62);
    expect(result[1].score).toBe(1 / 61);
  });

  it("deduplicates within each list, respects candidate limits and cuts topK after fusion", () => {
    const result = collectHybridCandidates(
      [{ id: "a", score: 1 }, { id: "ignored", score: 1 }],
      [{ id: "b", score: 8 }, { id: "ignored", score: 8 }],
      2, { hybridCandidateK: 1, rrfK: 10 },
    );
    expect(result).toEqual([
      { id: "a", score: 1 / 11, retrievalSource: "vector" },
      { id: "b", score: 1 / 11, retrievalSource: "bm25" },
    ]);
    expect(reciprocalRankFusion([[{ id: "a", score: 1 }, { id: "a", score: 1 }]])).toEqual([{ id: "a", score: 1 / 61 }]);
    expect(normalizeHybridSearchOptions({ hybridCandidateK: NaN, rrfK: -1 }))
      .toEqual({ hybridSearch: false, hybridCandidateK: 30, rrfK: 60 });
  });

  it("reports sources from the eligible, capped lists used for fusion", () => {
    const result = collectHybridCandidates(
      [{ id: "both", score: 0.9 }, { id: "lexical-only", score: 0.1 }],
      [{ id: "both", score: 3 }, { id: "lexical-only", score: 2 }],
      5, { hybridCandidateK: 2 },
    );
    expect(result.map(r => r.retrievalSource)).toEqual(["both", "both"]);
    const capped = collectHybridCandidates(
      [{ id: "vector-only", score: 0.9 }, { id: "lexical-only", score: 0.1 }],
      [{ id: "lexical-only", score: 3 }],
      5, { hybridCandidateK: 1 },
    );
    expect(capped.map(r => [r.id, r.retrievalSource])).toEqual([
      ["vector-only", "vector"], ["lexical-only", "bm25"],
    ]);
  });
});
