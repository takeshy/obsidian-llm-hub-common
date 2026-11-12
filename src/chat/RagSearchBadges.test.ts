import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { configureClassPrefix } from "../core/classPrefix.js";
import { setLocale } from "../i18n/index.js";
import { RagSearchModeBadge, RagSearchResultMeta } from "./RagSearchBadges.js";

afterEach(() => { setLocale("en"); configureClassPrefix("chat-ui"); });

describe("RAG search badges", () => {
  it("shows the current hybrid mode in Japanese", () => {
    setLocale("ja");
    const html = renderToStaticMarkup(createElement(RagSearchModeBadge, { hybridSearch: true }));
    expect(html).toContain("ハイブリッドON");
    expect(html).toContain('data-mode="hybrid"');
    expect(html).toContain('role="status"');
    expect(renderToStaticMarkup(createElement(RagSearchModeBadge, { hybridSearch: false }))).toContain("ベクトル検索");
  });

  it.each(["vector", "bm25", "both"] as const)("shows the %s retrieval source with an RRF score, never a percentage", source => {
    configureClassPrefix("llm-hub");
    const html = renderToStaticMarkup(createElement(RagSearchResultMeta, { score: 1 / 61, retrievalSource: source }));
    expect(html).toContain(`data-source="${source}"`);
    expect(html).toContain("llm-hub-rag-retrieval-source");
    expect(html).toContain("RRF 0.0164");
    expect(html).not.toContain("%");
    expect(html).toContain(source === "vector" ? "Vector" : source === "bm25" ? "BM25" : "Both");
  });

  it("preserves percentages for ordinary vector results without hybrid metadata", () => {
    const html = renderToStaticMarkup(createElement(RagSearchResultMeta, { score: 0.83 }));
    expect(html).toContain('data-source="vector"');
    expect(html).toContain("83.0%");
    expect(html).not.toContain("RRF");
  });
});
