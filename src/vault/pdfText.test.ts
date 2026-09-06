import { describe, it, expect, vi, beforeEach } from "vitest";
import { TFile } from "obsidian";
import * as obsidian from "obsidian";
import {
  extractPdfPages,
  extractPdfText,
  extractPdfTextWithOffsets,
  formatExtractedPdfText,
  computePdfPageLabel,
  MAX_EXTRACTED_PDF_CHARS,
} from "./pdfText.js";

/** Builds a PDF.js stand-in whose pages yield the given text items. */
function fakePdfJs(pages: string[][]) {
  const destroy = vi.fn(() => Promise.resolve());
  const lib = {
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: pages.length,
        getPage: (n: number) => Promise.resolve({
          getTextContent: () => Promise.resolve({
            items: pages[n - 1].map(str => ({ str, hasEOL: false })),
          }),
        }),
        destroy,
      }),
    }),
  };
  vi.spyOn(obsidian, "loadPdfJs").mockResolvedValue(lib);
  return { destroy };
}

function makeApp(mtime = 1) {
  const file = new TFile();
  file.path = "Docs/report.pdf";
  file.extension = "pdf";
  return {
    vault: {
      getAbstractFileByPath: () => file,
      readBinary: () => Promise.resolve(new ArrayBuffer(8)),
      adapter: { stat: () => Promise.resolve({ mtime, size: 10 }) },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Only the vault is exercised.
  } as any;
}

beforeEach(() => { vi.restoreAllMocks(); });

describe("extractPdfPages", () => {
  it("returns one entry per page in the requested range", async () => {
    fakePdfJs([["one"], ["two"], ["three"], ["four"]]);
    const result = await extractPdfPages(makeApp(), "Docs/report.pdf", 2, 3);
    expect(result).toEqual({ pages: ["two", "three"], firstPage: 2, numPages: 4 });
  });

  it("clamps a range that runs past the end of the document", async () => {
    fakePdfJs([["one"], ["two"]]);
    const result = await extractPdfPages(makeApp(), "Docs/report.pdf", 1, 99);
    expect(result?.pages).toEqual(["one", "two"]);
  });

  it("releases the document even after a successful read", async () => {
    const { destroy } = fakePdfJs([["one"]]);
    await extractPdfPages(makeApp(), "Docs/report.pdf");
    expect(destroy).toHaveBeenCalled();
  });

  it("reports a file it cannot open as null rather than throwing", async () => {
    vi.spyOn(obsidian, "loadPdfJs").mockRejectedValue(new Error("encrypted"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await extractPdfPages(makeApp(), "Docs/report.pdf")).toBeNull();
  });
});

describe("extractPdfText", () => {
  it("labels each page so a passage can be traced back", async () => {
    fakePdfJs([["alpha"], ["beta"]]);
    expect(await extractPdfText(makeApp(), "Docs/report.pdf"))
      .toBe("[Page 1]\nalpha\n\n[Page 2]\nbeta");
  });

  it("numbers pages from the start of the requested range", async () => {
    fakePdfJs([["a"], ["b"], ["c"]]);
    expect(await extractPdfText(makeApp(), "Docs/report.pdf", 3, 3)).toBe("[Page 3]\nc");
  });

  it("returns null for a PDF with no text layer", async () => {
    fakePdfJs([[""], [""]]);
    expect(await extractPdfText(makeApp(2), "Docs/report.pdf")).toBeNull();
  });

  it("serves an unchanged file from the cache", async () => {
    const spy = vi.spyOn(obsidian, "loadPdfJs");
    fakePdfJs([["cached"]]);
    const app = makeApp(3);
    await extractPdfText(app, "Docs/cached.pdf");
    await extractPdfText(app, "Docs/cached.pdf");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("extractPdfTextWithOffsets", () => {
  it("records where each page starts in the joined text", async () => {
    fakePdfJs([["aaa"], ["bb"]]);
    const result = await extractPdfTextWithOffsets(makeApp(), "Docs/report.pdf");
    expect(result).toEqual({ text: "aaa\nbb", numPages: 2, pageOffsets: [0, 4] });
  });

  it("points an empty page at where the next page's text begins", async () => {
    fakePdfJs([["aaa"], [""], ["bb"]]);
    const result = await extractPdfTextWithOffsets(makeApp(), "Docs/report.pdf");
    expect(result?.pageOffsets).toEqual([0, 3, 4]);
  });

  it("returns null when no page has any text", async () => {
    fakePdfJs([[""], [""]]);
    expect(await extractPdfTextWithOffsets(makeApp(), "Docs/report.pdf")).toBeNull();
  });
});

describe("formatExtractedPdfText", () => {
  it("passes short text through untouched", () => {
    expect(formatExtractedPdfText({ text: "short", numPages: 1, pageOffsets: [0] })).toBe("short");
  });

  it("says how much of the document a truncated extraction covers", () => {
    const text = "x".repeat(MAX_EXTRACTED_PDF_CHARS * 2);
    const result = formatExtractedPdfText({
      text,
      numPages: 400,
      pageOffsets: [0, MAX_EXTRACTED_PDF_CHARS - 1, MAX_EXTRACTED_PDF_CHARS + 1],
    });
    expect(result).toContain(`the first 2 of 400 pages`);
    expect(result).toContain(`${MAX_EXTRACTED_PDF_CHARS} of ${text.length} characters`);
  });
});

describe("computePdfPageLabel", () => {
  it("names the pages a chunk spans", () => {
    expect(computePdfPageLabel(5, 25, [0, 10, 20, 30], 24)).toBe("pages 1-3 of 24");
  });
});
