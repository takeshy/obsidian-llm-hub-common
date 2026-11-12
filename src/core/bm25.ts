import { createSearchTokenizer, type SearchTokenizer } from "./searchTokenizer.js";

export interface Bm25Document {
  id: string;
  text: string;
  /** The host's checksum/revision. Equal values skip tokenization during sync. */
  revision: string;
}

export interface RankedSearchCandidate {
  id: string;
  score: number;
}

export interface Bm25Snapshot {
  version: 1;
  tokenizer: string;
  /** IDs occur once; postings refer to document positions to keep JSON compact. */
  documents: Array<[id: string, revision: string, length: number]>;
  postings: Array<[term: string, frequencies: number[]]>;
}

interface IndexedDocument {
  revision: string;
  length: number;
  terms: Set<string>;
}

/** Pure inverted index: no Obsidian, filesystem or embedding dependency. */
export class Bm25Index {
  private documents = new Map<string, IndexedDocument>();
  private postings = new Map<string, Map<string, number>>();
  private totalLength = 0;

  constructor(readonly tokenizer: SearchTokenizer = createSearchTokenizer()) {}

  get size(): number { return this.documents.size; }
  get averageLength(): number { return this.size ? this.totalLength / this.size : 0; }

  /** Synchronize a corpus, retokenizing only added or changed documents. */
  update(documents: Iterable<Bm25Document>): void {
    const retained = new Set<string>();
    for (const doc of documents) {
      retained.add(doc.id);
      if (this.documents.get(doc.id)?.revision === doc.revision) continue;
      this.remove(doc.id);
      const tokens = this.tokenizer.tokenize(doc.text);
      const frequencies = new Map<string, number>();
      for (const term of tokens) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
      for (const [term, frequency] of frequencies) {
        let posting = this.postings.get(term);
        if (!posting) this.postings.set(term, posting = new Map());
        posting.set(doc.id, frequency);
      }
      this.documents.set(doc.id, { revision: doc.revision, length: tokens.length, terms: new Set(frequencies.keys()) });
      this.totalLength += tokens.length;
    }
    for (const id of this.documents.keys()) if (!retained.has(id)) this.remove(id);
  }

  private remove(id: string): void {
    const doc = this.documents.get(id);
    if (!doc) return;
    for (const term of doc.terms) {
      const posting = this.postings.get(term)!;
      posting.delete(id);
      if (!posting.size) this.postings.delete(term);
    }
    this.totalLength -= doc.length;
    this.documents.delete(id);
  }

  search(query: string, topK: number, accept: (id: string) => boolean = () => true): RankedSearchCandidate[] {
    if (!this.size || topK <= 0) return [];
    const scores = new Map<string, number>();
    const k1 = 1.2, b = 0.75;
    for (const term of new Set(this.tokenizer.tokenize(query))) {
      const posting = this.postings.get(term);
      if (!posting) continue;
      const idf = Math.log(1 + (this.size - posting.size + 0.5) / (posting.size + 0.5));
      for (const [id, tf] of posting) {
        if (!accept(id)) continue;
        const length = this.documents.get(id)!.length;
        const score = idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * length / (this.averageLength || 1)));
        scores.set(id, (scores.get(id) ?? 0) + score);
      }
    }
    return [...scores].map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, topK);
  }

  serialize(): Bm25Snapshot {
    const documents: Bm25Snapshot["documents"] = [...this.documents].map(([id, doc]) => [id, doc.revision, doc.length]);
    const positions = new Map(documents.map(([id], i) => [id, i]));
    return {
      version: 1, tokenizer: this.tokenizer.id, documents,
      postings: [...this.postings].map(([term, posting]) => [term, [...posting].flatMap(([id, tf]) => [positions.get(id)!, tf])]),
    };
  }

  /** Unknown versions, tokenizer modes and malformed caches are rebuilt by the host. */
  static deserialize(raw: unknown, tokenizer = createSearchTokenizer()): Bm25Index | null {
    if (!raw || typeof raw !== "object") return null;
    const value = raw as Partial<Bm25Snapshot>;
    if (value.version !== 1 || value.tokenizer !== tokenizer.id || !Array.isArray(value.documents) || !Array.isArray(value.postings)) return null;
    const index = new Bm25Index(tokenizer);
    const ids: string[] = [];
    for (const row of value.documents) {
      if (!Array.isArray(row) || row.length !== 3 || typeof row[0] !== "string" || typeof row[1] !== "string"
        || !Number.isSafeInteger(row[2]) || row[2] < 0 || index.documents.has(row[0])) return null;
      const [id, revision, length] = row;
      ids.push(id);
      index.documents.set(id, { revision, length, terms: new Set() });
      index.totalLength += length;
    }
    const lengths = new Map<string, number>();
    for (const row of value.postings) {
      if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== "string" || !row[0]
        || !Array.isArray(row[1]) || row[1].length % 2 || index.postings.has(row[0])) return null;
      const [term, frequencies] = row;
      const posting = new Map<string, number>();
      for (let i = 0; i < frequencies.length; i += 2) {
        const pos = frequencies[i], tf = frequencies[i + 1];
        if (!Number.isSafeInteger(pos) || pos < 0 || pos >= ids.length || !Number.isSafeInteger(tf) || tf < 1) return null;
        const id = ids[pos];
        if (posting.has(id)) return null;
        posting.set(id, tf);
        index.documents.get(id)!.terms.add(term);
        lengths.set(id, (lengths.get(id) ?? 0) + tf);
      }
      index.postings.set(term, posting);
    }
    for (const [id, doc] of index.documents) if (doc.length !== (lengths.get(id) ?? 0)) return null;
    return index;
  }
}
