import { describe, expect, it } from "vitest";
import { buildSearchSuggestionsDocument, SEARCH_SUGGESTIONS_SANDBOX } from "./SearchSuggestions.js";

describe("Search Suggestions frame (T14)", () => {
  const html = '<style>.chip{color:#1f1f1f}</style><div class="carousel"><a class="chip" href="https://www.google.com/search?q=a">a</a></div>';

  it("embeds Google's HTML/CSS byte for byte", () => {
    expect(buildSearchSuggestionsDocument(html)).toContain(html);
  });

  it("cannot run scripts, so it cannot reach the Vault or Node.js", () => {
    expect(SEARCH_SUGGESTIONS_SANDBOX.split(" ")).not.toContain("allow-scripts");
    expect(SEARCH_SUGGESTIONS_SANDBOX.split(" ")).not.toContain("allow-top-navigation");
    const doc = buildSearchSuggestionsDocument(html);
    expect(doc).toContain("script-src 'none'");
    expect(doc).toContain("default-src 'none'");
  });

  it("opens chips outside the frame", () => {
    expect(buildSearchSuggestionsDocument(html)).toContain('<base target="_blank">');
    expect(SEARCH_SUGGESTIONS_SANDBOX).toContain("allow-popups-to-escape-sandbox");
  });
});
