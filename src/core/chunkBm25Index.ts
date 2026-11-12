import { Bm25Index, type Bm25Snapshot, type RankedSearchCandidate } from "./bm25.js";
import type { SearchTokenizer } from "./searchTokenizer.js";

export interface SearchableChunk {
  filePath: string;
  text: string;
  chunkIndex?: number;
  startOffset?: number;
}

/** Cache revision only; two independent 32-bit accumulators avoid storing the text twice. */
function textRevision(text: string): string {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b, 33) ^ c;
  }
  return `${text.length}:${a >>> 0}:${b >>> 0}`;
}

/** Bridges stable chunk IDs during sync and metadata positions during retrieval. */
export class ChunkBm25Index {
  private index: Bm25Index;
  private positions = new Map<string, number>();

  constructor(chunks: readonly SearchableChunk[], snapshot?: unknown, tokenizer?: SearchTokenizer) {
    this.index = Bm25Index.deserialize(snapshot, tokenizer) ?? new Bm25Index(tokenizer);
    this.update(chunks);
  }

  update(chunks: readonly SearchableChunk[]): void {
    const occurrences = new Map<string, number>();
    this.positions.clear();
    const documents = chunks.map((chunk, i) => {
      const key = JSON.stringify([chunk.filePath, chunk.chunkIndex ?? chunk.startOffset ?? 0]);
      const occurrence = occurrences.get(key) ?? 0;
      occurrences.set(key, occurrence + 1);
      // Duplicate chunks from merged indexes remain separate candidates.
      const id = `${key}:${occurrence}`;
      this.positions.set(id, i);
      return { id, text: chunk.text, revision: textRevision(chunk.text) };
    });
    this.index.update(documents);
  }

  search(query: string, topK: number, accept: (position: number) => boolean = () => true): RankedSearchCandidate[] {
    return this.index.search(query, topK, id => accept(this.positions.get(id)!))
      .map(({ id, score }) => ({ id: String(this.positions.get(id)!), score }));
  }

  serialize(): Bm25Snapshot { return this.index.serialize(); }
}
