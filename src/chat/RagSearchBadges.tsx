import { getClassPrefix } from "../core/classPrefix.js";
import type { RagRetrievalSource } from "../core/hybridSearch.js";
import { t } from "../i18n/index.js";

/** Current search mode; results keep their own mode even if settings change. */
export function RagSearchModeBadge({ hybridSearch }: { hybridSearch: boolean }) {
  return (
    <span
      className={`${getClassPrefix()}-rag-search-mode`}
      data-mode={hybridSearch ? "hybrid" : "vector"}
      title={t(hybridSearch ? "search.hybridModeDescription" : "search.cosineScoreDescription")}
      role="status"
    >
      {t(hybridSearch ? "search.hybridOn" : "search.vectorMode")}
    </span>
  );
}

export interface RagSearchResultMetaProps {
  score: number;
  /** Present only for fused results; absent means the existing cosine score. */
  retrievalSource?: RagRetrievalSource;
}

export function RagSearchResultMeta({ score, retrievalSource }: RagSearchResultMetaProps) {
  const prefix = getClassPrefix();
  const source = retrievalSource ?? "vector";
  const label = source === "bm25" ? "BM25" : t(source === "both" ? "search.sourceBoth" : "search.sourceVector");
  return (
    <span className={`${prefix}-rag-retrieval-meta`}>
      <span className={`${prefix}-rag-retrieval-source`} data-source={source} title={t("search.retrievalSource")}>
        {label}
      </span>
      <span
        className={`${prefix}-search-result-score`}
        title={t(retrievalSource ? "search.rrfScoreDescription" : "search.cosineScoreDescription")}
      >
        {retrievalSource ? `RRF ${score.toFixed(4)}` : `${(score * 100).toFixed(1)}%`}
      </span>
    </span>
  );
}
