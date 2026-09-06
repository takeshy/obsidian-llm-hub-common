import { TFile, loadPdfJs, type App } from "obsidian";
import { PDFDocument } from "pdf-lib";
import type { Attachment } from "../core/message.js";

/** Base64 of a PDF inflates by 4/3 and providers cap a whole request near 32 MB. */
export const MAX_NATIVE_PDF_BYTES = 15 * 1024 * 1024;

interface PdfJsTextItem {
  str?: unknown;
  hasEOL?: unknown;
}

interface PdfJsDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<{ getTextContent(): Promise<{ items: PdfJsTextItem[] }> }>;
  destroy?(): Promise<void>;
}

interface PdfJsLib {
  getDocument(source: { data: ArrayBuffer }): { promise: Promise<PdfJsDocument> };
}

// Extracted text, keyed by "path:startPage-endPage" and invalidated by mtime/size.
const pdfTextCache = new Map<string, { mtime: number; size: number; text: string | null }>();

/** Join a page's text items, honouring PDF.js end-of-line markers so lists and tables survive. */
function joinTextItems(items: PdfJsTextItem[]): string {
  let text = "";
  for (const item of items) {
    if (typeof item.str === "string") text += item.str;
    text += item.hasEOL === true ? "\n" : " ";
  }
  return text.replace(/[ \t]+\n/g, "\n").trim();
}

function isAbsolutePath(filePath: string): boolean {
  return filePath.startsWith("/") || /^[A-Z]:\\/i.test(filePath);
}

/** Reads a PDF from the vault, or from disk when given an absolute path. */
async function readPdfBytes(app: App, filePath: string): Promise<ArrayBuffer | null> {
  if (!isAbsolutePath(filePath)) {
    const file = app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return null;
    return app.vault.readBinary(file);
  }
  const fs = (window as { require?: (id: string) => { promises: { readFile: (p: string) => Promise<Buffer> } } })
    .require?.("fs");
  if (!fs) return null;
  const nodeBuffer = await fs.promises.readFile(filePath);
  return nodeBuffer.buffer.slice(
    nodeBuffer.byteOffset,
    nodeBuffer.byteOffset + nodeBuffer.byteLength,
  ) as ArrayBuffer;
}

export interface PdfPages {
  /** One entry per page in the requested range; a page with no text layer is "". */
  pages: string[];
  /** 1-based number of the first entry in `pages`. */
  firstPage: number;
  /** Pages in the whole document, not just the requested range. */
  numPages: number;
}

/**
 * Read a PDF's text layer page by page with Obsidian's bundled PDF.js. This is the one
 * place that opens a PDF; the text, offset and attachment helpers below all build on it.
 * Returns null when the file could not be read at all; failures are logged so a
 * password-protected or corrupt file stays diagnosable.
 * @param startPage 1-based, inclusive. Omit for the whole document.
 * @param endPage 1-based, inclusive. Omit for the whole document.
 */
export async function extractPdfPages(
  app: App,
  filePath: string,
  startPage?: number,
  endPage?: number,
): Promise<PdfPages | null> {
  let pdf: PdfJsDocument | null = null;
  try {
    const buffer = await readPdfBytes(app, filePath);
    if (!buffer) return null;

    const pdfJs = await loadPdfJs() as PdfJsLib;
    pdf = await pdfJs.getDocument({ data: buffer }).promise;

    const from = startPage ?? 1;
    const to = Math.min(endPage ?? pdf.numPages, pdf.numPages);
    const pages: string[] = [];
    for (let pageNumber = from; pageNumber <= to; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(joinTextItems(content.items));
    }
    return { pages, firstPage: from, numPages: pdf.numPages };
  } catch (error) {
    console.error(`Failed to extract text from PDF "${filePath}"`, error);
    return null;
  } finally {
    // PDF.js keeps the parsed document alive in its worker until it is destroyed.
    try {
      await pdf?.destroy?.();
    } catch (error) {
      console.error(`Failed to release PDF "${filePath}"`, error);
    }
  }
}

/**
 * The text layer of a PDF, or one page range of it, with each page labelled so a reader
 * (and the model) can cite where a passage came from. Null when the PDF has no text layer
 * at all — a scan, say — which callers report rather than passing off an empty document.
 *
 * Results are cached per path and range until the file changes on disk.
 */
export async function extractPdfText(
  app: App,
  filePath: string,
  startPage?: number,
  endPage?: number,
): Promise<string | null> {
  const cacheKey = `${filePath}:${startPage ?? 0}-${endPage ?? 0}`;
  const stat = isAbsolutePath(filePath) ? null : await app.vault.adapter.stat(filePath);
  if (stat) {
    const cached = pdfTextCache.get(cacheKey);
    if (cached && cached.mtime === stat.mtime && cached.size === stat.size) {
      return cached.text;
    }
  }

  const extracted = await extractPdfPages(app, filePath, startPage, endPage);
  const labelled = (extracted?.pages ?? [])
    .map((text, index) => text ? `[Page ${(extracted?.firstPage ?? 1) + index}]\n${text}` : "")
    .filter(Boolean);
  const result = labelled.length > 0 ? labelled.join("\n\n") : null;
  if (stat) pdfTextCache.set(cacheKey, { mtime: stat.mtime, size: stat.size, text: result });
  return result;
}

export interface PdfExtractResult {
  text: string;
  numPages: number;
  /** Character offset where each page starts in `text`. */
  pageOffsets: number[];
}

/**
 * The same text layer, but with the offset each page starts at, so a chunk of the text
 * can be traced back to the pages it came from. Pages with no text share the offset of
 * the next page that has some.
 */
export async function extractPdfTextWithOffsets(
  app: App,
  filePath: string,
  startPage?: number,
  endPage?: number,
): Promise<PdfExtractResult | null> {
  const extracted = await extractPdfPages(app, filePath, startPage, endPage);
  if (!extracted) return null;

  const parts: string[] = [];
  const pageOffsets: number[] = [];
  let offset = 0;
  for (const pageText of extracted.pages) {
    if (!pageText) {
      // Empty page: point at the current end, which is where the next page's text starts.
      pageOffsets.push(offset);
      continue;
    }
    if (parts.length > 0) offset++;  // the "\n" separator
    pageOffsets.push(offset);
    parts.push(pageText);
    offset += pageText.length;
  }
  if (parts.length === 0) return null;
  return { text: parts.join("\n"), numPages: extracted.numPages, pageOffsets };
}

/** A long PDF's text layer would otherwise crowd the rest of the conversation out of the context window. */
export const MAX_EXTRACTED_PDF_CHARS = 60_000;

/** Cap extracted PDF text, telling the model how much of the document it got. */
export function formatExtractedPdfText(extracted: PdfExtractResult): string {
  if (extracted.text.length <= MAX_EXTRACTED_PDF_CHARS) return extracted.text;
  const truncated = extracted.text.slice(0, MAX_EXTRACTED_PDF_CHARS);
  const pagesIncluded = extracted.pageOffsets.filter(offset => offset < truncated.length).length;
  return `${truncated}\n\n[Truncated: the first ${pagesIncluded} of ${extracted.numPages} pages (${truncated.length} of ${extracted.text.length} characters). Ask the user to narrow the request if a later page is needed.]`;
}

/** Computes a chunk's page label, e.g. "pages 2-5 of 24", from its character offsets. */
export function computePdfPageLabel(
  startOffset: number,
  endOffset: number,
  pageOffsets: number[],
  numPages: number,
): string {
  let startPage = 1;
  let endPage = 1;
  for (let i = 0; i < pageOffsets.length; i++) {
    if (pageOffsets[i] <= startOffset) startPage = i + 1;
    if (pageOffsets[i] <= endOffset) endPage = i + 1;
  }
  return `pages ${startPage}-${endPage} of ${numPages}`;
}

export interface PdfAttachment {
  attachment: Attachment;
  /** Set when a page range was extracted, e.g. "3-7". */
  pageRange?: string;
  startPage?: number;
  endPage?: number;
}

/** Encode bytes as base64 in chunks, so a large PDF does not blow the call stack. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Read a PDF as a native document attachment, preserving the layout, figures and scanned
 * pages a text extraction would lose. A page range is sliced out first, so a chapter of a
 * large book can be sent even when the whole file is over the limit.
 *
 * Returns null when the result would still be too large or the file cannot be read, so
 * callers fall back to {@link extractPdfText}. Throws only when the requested range does
 * not exist, which is a caller error worth reporting rather than silently narrowing.
 */
export async function readPdfAttachment(
  app: App,
  file: TFile,
  startPage?: number,
  endPage?: number,
): Promise<PdfAttachment | null> {
  const hasPageRange = startPage !== undefined || endPage !== undefined;
  try {
    const buffer = await app.vault.readBinary(file);
    let bytes: Uint8Array = new Uint8Array(buffer);
    let pageRange: string | undefined;
    let from: number | undefined;
    let to: number | undefined;

    if (hasPageRange) {
      const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const totalPages = source.getPageCount();
      from = startPage ?? 1;
      to = Math.min(endPage ?? totalPages, totalPages);
      if (from > totalPages) {
        throw new RangeError(`startPage ${from} exceeds the PDF's ${totalPages} pages`);
      }
      const selected = await PDFDocument.create();
      const indices = Array.from({ length: to - from + 1 }, (_, index) => from! - 1 + index);
      for (const page of await selected.copyPages(source, indices)) selected.addPage(page);
      bytes = await selected.save();
      pageRange = `${from}-${to}`;
    }

    if (bytes.byteLength > MAX_NATIVE_PDF_BYTES) return null;
    return {
      attachment: {
        name: file.name,
        type: "pdf",
        mimeType: "application/pdf",
        data: bytesToBase64(bytes),
        sourcePath: file.path,
        ...(pageRange ? { pageLabel: `pages ${pageRange}` } : {}),
      },
      pageRange,
      startPage: from,
      endPage: to,
    };
  } catch (error) {
    if (error instanceof RangeError) throw error;
    console.error(`Failed to read PDF "${file.path}" for attachment`, error);
    return null;
  }
}
