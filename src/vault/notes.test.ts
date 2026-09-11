import { beforeEach, describe, expect, it, vi } from "vitest";
import { App, TFile } from "obsidian";
import { initEditHistoryManager, resetEditHistoryManager } from "../core/editHistory.js";
import { clearAllHistories } from "../core/editHistoryStore.js";
import {
  applyBulkEdit,
  applyEdit,
  clearPendingBulkEdit,
  discardEdit,
  findReadableFileByName,
  getPendingEdit,
  getPendingBulkEdit,
  proposeBulkEdit,
  proposeEdit,
} from "./notes.js";
import { findFileByName, readNote, readNoteContext, resolveNoteFile } from "./notes.js";
import { extractPdfText } from "./pdfText.js";
import { PDFDocument } from "pdf-lib";

vi.mock("./pdfText.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./pdfText.js")>()),
  extractPdfText: vi.fn(async () => "Extracted PDF text"),
}));

function makeFile(path: string, size = 1024): TFile {
  const file = new TFile();
  const name = path.split("/").pop() ?? path;
  const lastDot = name.lastIndexOf(".");
  file.path = path;
  file.name = name;
  file.basename = lastDot > 0 ? name.slice(0, lastDot) : name;
  file.extension = lastDot > 0 ? name.slice(lastDot + 1) : "";
  file.stat = { size, mtime: 0, ctime: 0 };
  return file;
}

function makeApp(files: TFile[], binary = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer): App {
  return {
    vault: {
      getFiles: () => files,
      getAbstractFileByPath: (path: string) => files.find(file => file.path === path) ?? null,
      read: vi.fn(async () => "text content"),
      readBinary: vi.fn(async () => binary),
    },
  } as unknown as App;
}

describe("findFileByName", () => {
  it("prefers markdown when the lookup omits an extension", () => {
    const app = makeApp([
      makeFile("Plan.canvas"),
      makeFile("Plan.md"),
    ]);

    expect(findFileByName(app, "Plan")?.path).toBe("Plan.md");
  });

  it("resolves explicit non-markdown extensions", () => {
    const app = makeApp([
      makeFile("Plan.md"),
      makeFile("Plan.canvas"),
    ]);

    expect(findFileByName(app, "Plan.canvas")?.path).toBe("Plan.canvas");
  });

  it("resolves Obsidian Base files", () => {
    const app = makeApp([makeFile("Dashboards/Projects.base")]);

    expect(findFileByName(app, "Projects.base")?.path).toBe("Dashboards/Projects.base");
  });

  it("resolves Dashboard files", () => {
    const app = makeApp([makeFile("Dashboards/Projects.dashboard")]);

    expect(findFileByName(app, "Projects.dashboard")?.path).toBe("Dashboards/Projects.dashboard");
  });

  it("resolves an explicit PDF only through the read-only lookup", () => {
    const vault = new MockVault();
    vault.addFile("docs/Manual.pdf", "binary");
    const app = createMockApp(vault);

    expect(findFileByName(app, "docs/Manual.pdf")).toBeNull();
    expect(findReadableFileByName(app, "docs/Manual.pdf")?.path).toBe("docs/Manual.pdf");
  });

  it("prefers the shortest path when PDF names collide", () => {
    const vault = new MockVault();
    vault.addFile("Archive/2023/Manual.pdf", "binary");
    vault.addFile("Manual.pdf", "binary");
    const app = createMockApp(vault);

    expect(findReadableFileByName(app, "Manual.pdf")?.path).toBe("Manual.pdf");
  });

  it("fuzzy-matches a PDF the same way it matches text files", () => {
    const vault = new MockVault();
    vault.addFile("docs/Quarterly Report.pdf", "binary");
    const app = createMockApp(vault);

    expect(findReadableFileByName(app, "Quarterly Report")?.path).toBe("docs/Quarterly Report.pdf");
    expect(findReadableFileByName(app, "quarterly")?.path).toBe("docs/Quarterly Report.pdf");
  });

  it("prefers a markdown note over a same-named PDF for extension-less lookups", () => {
    const vault = new MockVault();
    vault.addFile("archive/Manual.pdf", "binary");
    vault.addMarkdownFile("notes/deep/Manual.md", "# Manual");
    const app = createMockApp(vault);

    expect(findReadableFileByName(app, "Manual")?.path).toBe("notes/deep/Manual.md");
  });
});

describe("readNote PDF support", () => {
  it("extracts PDF text without changing the legacy text-file result shape", async () => {
    const pdf = makeFile("Docs/report.pdf");
    const result = await readNote(makeApp([pdf]), pdf.path, false, 1000, "extract-text");

    expect(result).toEqual({
      success: true,
      content: "Extracted PDF text",
      path: pdf.path,
      truncated: false,
    });
  });

  it("passes the selected page range to PDF text extraction", async () => {
    const pdf = makeFile("Docs/report.pdf");
    await readNote(makeApp([pdf]), pdf.path, false, 1000, "extract-text", 3, 7);

    expect(extractPdfText).toHaveBeenLastCalledWith(expect.anything(), pdf.path, 3, 7);
  });

  it("returns the selected range as result metadata", async () => {
    const pdf = makeFile("Docs/report.pdf");

    const result = await readNote(makeApp([pdf]), pdf.path, false, 1000, "extract-text", 42, 43);

    expect(result).toEqual(expect.objectContaining({ startPage: 42, endPage: 43 }));
  });

  it("returns a native PDF attachment when requested", async () => {
    const pdf = makeFile("Docs/report.pdf");
    const result = await readNote(makeApp([pdf]), pdf.path, false, 1000, "native");

    expect(result.success).toBe(true);
    expect(result.attachments).toEqual([expect.objectContaining({
      name: "report.pdf",
      type: "pdf",
      mimeType: "application/pdf",
      sourcePath: pdf.path,
    })]);
    expect(result.attachments?.[0].data).toBe("JVBERg==");
  });

  it("tells the model a native attachment does not survive the turn", async () => {
    const pdf = makeFile("Docs/report.pdf");
    const result = await readNote(makeApp([pdf]), pdf.path, false, 1000, "native");

    expect(result.content).toContain("for this turn");
    expect(result.content).toContain("read_note again");
  });

  it("attaches only the selected pages in native PDF mode", async () => {
    const source = await PDFDocument.create();
    source.addPage();
    source.addPage();
    source.addPage();
    const bytes = await source.save();
    const pdf = makeFile("Docs/report.pdf", bytes.byteLength);

    const result = await readNote(
      makeApp([pdf], bytes.buffer as ArrayBuffer), pdf.path, false, 1000, "native", 2, 3,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("pages 2-3");
    const attached = Uint8Array.from(atob(result.attachments![0].data), character => character.charCodeAt(0));
    expect((await PDFDocument.load(attached)).getPageCount()).toBe(2);
  });

  it("rejects invalid PDF page ranges", async () => {
    const pdf = makeFile("Docs/report.pdf");

    const result = await readNote(makeApp([pdf]), pdf.path, false, 1000, "extract-text", 5, 2);

    expect(result.success).toBe(false);
    expect(result.error).toContain("less than or equal");
  });

  it("falls back to text extraction when a native PDF is too large to send", async () => {
    const pdf = makeFile("Docs/huge.pdf", 40 * 1024 * 1024);
    const result = await readNote(makeApp([pdf]), pdf.path, false, 1000, "native");

    expect(result.attachments).toBeUndefined();
    expect(result.content).toBe("Extracted PDF text");
  });

  it("explains when a scanned PDF has no extractable text", async () => {
    vi.mocked(extractPdfText).mockResolvedValueOnce(null);
    const pdf = makeFile("Docs/scanned.pdf");
    const result = await readNote(makeApp([pdf]), pdf.path, false, 1000, "extract-text");

    expect(result.success).toBe(false);
    expect(result.error).toContain("no extractable text");
    expect(result.error).toContain("native PDF input");
  });
});

describe("resolveNoteFile", () => {
  it("finds a PDF referenced by name only", () => {
    const app = makeApp([makeFile("Private/secret.pdf")]);

    expect(resolveNoteFile(app, "secret.pdf")?.path).toBe("Private/secret.pdf");
  });

  it("resolves the same target readNote reads, so scope checks cannot be bypassed", async () => {
    const app = makeApp([makeFile("Private/secret.pdf")]);
    const resolved = resolveNoteFile(app, "secret.pdf");
    const result = await readNote(app, "secret.pdf", false, 1000, "extract-text");

    expect(result.path).toBe(resolved?.path);
  });
});

describe("readNote non-text files", () => {
  it("reads an inclusive line range and reports its location", async () => {
    const note = makeFile("Docs/long.md");
    const app = makeApp([note]);
    vi.mocked(app.vault.read).mockResolvedValueOnce("one\ntwo\nthree\nfour\n");

    const result = await readNote(app, note.path, false, 1000, "extract-text", undefined, undefined, 2, 3);

    expect(result).toMatchObject({ content: "two\nthree\n", startLine: 2, endLine: 3, totalLines: 4, truncated: false });
  });

  it("rejects an invalid text line range", async () => {
    const note = makeFile("Docs/long.md");
    const result = await readNote(makeApp([note]), note.path, false, 1000, "extract-text", undefined, undefined, 3, 2);

    expect(result).toMatchObject({ success: false, error: expect.stringContaining("less than or equal") });
  });

  it("finds text with merged context windows", async () => {
    const vault = new MockVault();
    const note = vault.addMarkdownFile("Docs/long.md", "zero\nneedle one\nbetween\nneedle two\nlast");

    const result = await readNoteContext(createMockApp(vault), note.path, false, "NEEDLE", 1, 1);

    expect(result).toMatchObject({ success: true, matchCount: 1, matches: [{ startLine: 1, endLine: 5, content: "zero\nneedle one\nbetween\nneedle two\nlast" }] });
  });

  it("reads Obsidian Base files as text", async () => {
    const base = makeFile("Dashboards/Projects.base");
    const app = makeApp([base]);
    vi.mocked(app.vault.read).mockResolvedValueOnce("views:\n  - type: table");

    const result = await readNote(app, base.path);

    expect(result).toEqual({
      success: true,
      content: "views:\n  - type: table",
      path: base.path,
      truncated: false,
    });
  });

  it("reads Dashboard files as text", async () => {
    const dashboard = makeFile("Dashboards/Projects.dashboard");
    const app = makeApp([dashboard]);
    vi.mocked(app.vault.read).mockResolvedValueOnce("layout:\n  type: grid");

    const result = await readNote(app, dashboard.path);

    expect(result).toEqual({
      success: true,
      content: "layout:\n  type: grid",
      path: dashboard.path,
      truncated: false,
    });
  });

  it("refuses binaries that are not PDFs instead of returning mojibake", async () => {
    const png = makeFile("Assets/photo.png");
    const result = await readNote(makeApp([png]), png.path, false, 1000, "extract-text");

    expect(result.success).toBe(false);
    expect(result.error).toContain("not a readable note");
  });
});

class MockVault {
  private files = new Map<string, TFile>();
  private contents = new Map<string, string>();

  addFile(path: string, content: string): TFile {
    const file = new TFile();
    file.path = path;
    file.name = path.split("/").pop() ?? path;
    const lastDot = file.name.lastIndexOf(".");
    file.extension = lastDot > 0 ? file.name.slice(lastDot + 1) : "";
    file.basename = lastDot > 0 ? file.name.slice(0, lastDot) : file.name;

    this.files.set(path, file);
    this.contents.set(path, content);
    return file;
  }

  addMarkdownFile(path: string, content: string): TFile {
    return this.addFile(path, content);
  }

  getFiles(): TFile[] {
    return [...this.files.values()];
  }

  getMarkdownFiles(): TFile[] {
    return [...this.files.values()].filter((file) => file.extension === "md");
  }

  getAbstractFileByPath(path: string): TFile | null {
    return this.files.get(path) ?? null;
  }

  async read(file: TFile): Promise<string> {
    return this.contents.get(file.path) ?? "";
  }

  async modify(file: TFile, content: string): Promise<void> {
    this.contents.set(file.path, content);
  }

  setContent(path: string, content: string): void {
    this.contents.set(path, content);
  }

  getContent(path: string): string {
    return this.contents.get(path) ?? "";
  }
}

function createMockApp(vault: MockVault, activeFile?: TFile): App {
  return {
    vault,
    workspace: {
      getActiveFile: () => activeFile ?? null,
      getLeaf: () => ({
        openFile: async () => undefined,
      }),
    },
  } as unknown as App;
}

describe("notes edit history integration", () => {
  beforeEach(() => {
    clearAllHistories();
    resetEditHistoryManager();
    discardEdit({} as App);
    clearPendingBulkEdit();
  });

  it("keeps applying the approved edit when a new proposal arrives during snapshot I/O", async () => {
    const vault = new MockVault();
    vault.addMarkdownFile("a.md", "old a");
    vault.addMarkdownFile("b.md", "old b");
    const app = createMockApp(vault);
    const history = initEditHistoryManager(app, { enabled: true, diff: { contextLines: 3 } });
    await proposeEdit(app, "a.md", false, "approved a");
    vi.spyOn(history, "ensureSnapshot").mockImplementationOnce(async () => {
      await proposeEdit(app, "b.md", false, "unapproved b");
    });
    const result = await applyEdit(app, { openFile: false });
    expect(result).toMatchObject({ success: true, path: "a.md" });
    expect(vault.getContent("a.md")).toBe("approved a");
    expect(vault.getContent("b.md")).toBe("old b");
    expect(getPendingEdit()?.originalPath).toBe("b.md");
  });

  it("does not discard a newer bulk proposal when the previous application finishes", async () => {
    const vault = new MockVault();
    vault.addMarkdownFile("a.md", "old a");
    vault.addMarkdownFile("b.md", "old b");
    const app = createMockApp(vault);
    await proposeBulkEdit(app, [{ fileName: "a.md", newContent: "approved a" }]);
    const modify = vault.modify.bind(vault);
    vi.spyOn(vault, "modify").mockImplementationOnce(async (file, content) => {
      await proposeBulkEdit(app, [{ fileName: "b.md", newContent: "unapproved b" }]);
      await modify(file, content);
    });
    expect((await applyBulkEdit(app, ["a.md"])).applied).toEqual(["a.md"]);
    expect(vault.getContent("a.md")).toBe("approved a");
    expect(vault.getContent("b.md")).toBe("old b");
    expect(getPendingBulkEdit()?.items[0].path).toBe("b.md");
  });

  it("records external changes before applyEdit as auto history", async () => {
    const vault = new MockVault();
    const file = vault.addMarkdownFile("daily.md", "v1\n");
    const app = createMockApp(vault, file);
    const historyManager = initEditHistoryManager(app, {
      enabled: true,
      diff: { contextLines: 3 },
    });

    await historyManager.ensureSnapshot(file.path);

    const proposeResult = await proposeEdit(app, undefined, true, "v3\n");
    expect(proposeResult.success).toBe(true);

    vault.setContent(file.path, "v2\n");

    const applyResult = await applyEdit(app);
    expect(applyResult.success).toBe(true);
    expect(vault.getContent(file.path)).toBe("v3\n");

    const entries = historyManager.getHistory(file.path);
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.source)).toEqual(["auto", "propose_edit"]);
    expect(historyManager.getSnapshot(file.path)).toBe("v3\n");
    expect(historyManager.getContentAt(file.path, entries[1].id)).toBe("v2\n");
    expect(historyManager.getContentAt(file.path, entries[0].id)).toBe("v1\n");
  });

  it("records external changes before applyBulkEdit as auto history", async () => {
    const vault = new MockVault();
    vault.addMarkdownFile("bulk.md", "one\n");
    const app = createMockApp(vault);
    const historyManager = initEditHistoryManager(app, {
      enabled: true,
      diff: { contextLines: 3 },
    });

    await historyManager.ensureSnapshot("bulk.md");

    const proposeResult = await proposeBulkEdit(app, [
      { fileName: "bulk", newContent: "three\n", mode: "replace" },
    ]);
    expect(proposeResult.success).toBe(true);

    vault.setContent("bulk.md", "two\n");

    const applyResult = await applyBulkEdit(app, ["bulk.md"]);
    expect(applyResult.success).toBe(true);
    expect(applyResult.applied).toEqual(["bulk.md"]);
    expect(vault.getContent("bulk.md")).toBe("three\n");

    const entries = historyManager.getHistory("bulk.md");
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.source)).toEqual(["auto", "propose_edit"]);
    expect(historyManager.getSnapshot("bulk.md")).toBe("three\n");
    expect(historyManager.getContentAt("bulk.md", entries[1].id)).toBe("two\n");
    expect(historyManager.getContentAt("bulk.md", entries[0].id)).toBe("one\n");
  });
});
