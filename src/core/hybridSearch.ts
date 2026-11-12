import type { RankedSearchCandidate } from "./bm25.js";

export interface HybridSearchOptions {
  hybridSearch: boolean;
  hybridCandidateK: number;
  rrfK: number;
}

export type RagRetrievalSource = "vector" | "bm25" | "both";

export interface HybridSearchCandidate extends RankedSearchCandidate {
  retrievalSource: RagRetrievalSource;
}

export const DEFAULT_HYBRID_SEARCH: HybridSearchOptions = {
  hybridSearch: false,
  hybridCandidateK: 30,
  rrfK: 60,
};

export function normalizeHybridSearchOptions(options: Partial<HybridSearchOptions>): HybridSearchOptions {
  return {
    hybridSearch: options.hybridSearch === true,
    hybridCandidateK: Number.isFinite(options.hybridCandidateK) && options.hybridCandidateK! >= 1
      ? Math.floor(options.hybridCandidateK!) : DEFAULT_HYBRID_SEARCH.hybridCandidateK,
    rrfK: Number.isFinite(options.rrfK) && options.rrfK! > 0 ? options.rrfK! : DEFAULT_HYBRID_SEARCH.rrfK,
  };
}

/** Rank starts at 1. Raw BM25 and cosine scores are intentionally never mixed. */
export function reciprocalRankFusion(lists: readonly (readonly RankedSearchCandidate[])[], k = 60): RankedSearchCandidate[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    const seen = new Set<string>();
    let rank = 0;
    for (const { id } of list) {
      if (seen.has(id)) continue;
      seen.add(id);
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + ++rank));
    }
  }
  // Map insertion order gives deterministic ties, preferring the first (vector) list.
  return [...scores].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}

/** Candidate selection is separate from downstream filters/rerankers. */
export function collectHybridCandidates(
  vector: readonly RankedSearchCandidate[], lexical: readonly RankedSearchCandidate[],
  topK: number, options: Partial<HybridSearchOptions>,
): HybridSearchCandidate[] {
  const normalized = normalizeHybridSearchOptions(options);
  const vectorCandidates = vector.slice(0, normalized.hybridCandidateK);
  const lexicalCandidates = lexical.slice(0, normalized.hybridCandidateK);
  const vectorIds = new Set(vectorCandidates.map(candidate => candidate.id));
  const lexicalIds = new Set(lexicalCandidates.map(candidate => candidate.id));
  return reciprocalRankFusion([
    vectorCandidates, lexicalCandidates,
  ], normalized.rrfK).slice(0, topK).map(candidate => ({
    ...candidate,
    retrievalSource: vectorIds.has(candidate.id)
      ? lexicalIds.has(candidate.id) ? "both" : "vector" : "bm25",
  }));
}
