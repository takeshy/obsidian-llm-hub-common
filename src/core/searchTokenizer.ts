/** A stable mode ID lets persisted indexes detect a tokenizer change. */
export interface SearchTokenizer {
  id: string;
  tokenize(text: string): string[];
}

interface WordSegmenter {
  segment(text: string): Iterable<{ segment: string; isWordLike?: boolean }>;
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー]+/gu;

/** Overlapping bigrams preserve matches inside Japanese words without a dictionary. */
function bigrams(text: string): string[] {
  const chars = Array.from(text);
  return chars.length < 2 ? chars : chars.slice(0, -1).map((c, i) => c + chars[i + 1]);
}

export function createSearchTokenizer(forceBigrams = false): SearchTokenizer {
  // Use a fixed locale, independent of the UI language, on both documents and queries.
  const Segmenter = (Intl as typeof Intl & {
    Segmenter?: new (locale: string, options: { granularity: "word" }) => WordSegmenter;
  }).Segmenter;
  let segmenter: WordSegmenter | null = null;
  if (!forceBigrams && Segmenter) {
    try { segmenter = new Segmenter("ja", { granularity: "word" }); }
    catch { /* Some older runtimes expose an unusable implementation. */ }
  }
  return {
    id: segmenter ? "word-ja-v1" : "cjk-bigram-v1",
    tokenize(text) {
      const normalized = text.normalize("NFKC").toLowerCase();
      const tokens: string[] = [];
      // Separate CJK runs from Latin/number identifiers even without whitespace.
      const latin = normalized.replace(CJK_RUN, run => {
        if (segmenter) {
          for (const word of segmenter.segment(run)) {
            if (word.isWordLike) tokens.push(word.segment);
          }
        } else tokens.push(...bigrams(run));
        return " ";
      });
      for (const match of latin.matchAll(/[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)*/gu)) {
        const token = match[0];
        if (CJK.test(token)) continue;
        tokens.push(token);
        // Keep PRJ-123 / snake_case whole, and make their components searchable.
        if (/[-_]/.test(token)) tokens.push(...token.split(/[-_]/));
      }
      return tokens;
    },
  };
}
