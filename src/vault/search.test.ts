import { describe, expect, it, vi } from "vitest";
import { App, TFile, TFolder } from "obsidian";
import { listFolders, listNotes, searchByContent, searchByName } from "./search.js";

vi.mock("./pdfText.js", () => ({
  extractPdfText: vi.fn(async (_app: unknown, path: string) =>
    path === "Public/report.pdf" ? "quarterly revenue figures" : null),
}));

function makeFile(path: string, mtime = 0): TFile {
  const file = new TFile();
  const name = path.split("/").pop() ?? path;
  const lastDot = name.lastIndexOf(".");
  file.path = path;
  file.name = name;
  file.basename = lastDot > 0 ? name.slice(0, lastDot) : name;
  file.extension = lastDot > 0 ? name.slice(lastDot + 1) : "";
  file.stat = { size: 10, mtime, ctime: 0 };
  file.parent = path.includes("/") ? makeFolder(path.slice(0, path.lastIndexOf("/"))) : null;
  return file;
}

function makeFolder(path: string): TFolder {
  const folder = new TFolder();
  folder.path = path;
  folder.name = path.split("/").pop() ?? path;
  return folder;
}

function makeApp(files: TFile[], folders: TFolder[] = [], contents: Record<string, string> = {}): App {
  return {
    vault: {
      getFiles: () => files,
      getAllLoadedFiles: () => [...folders, ...files],
      getAbstractFileByPath: (path: string) =>
        folders.find(f => f.path === path) ?? files.find(f => f.path === path) ?? null,
      cachedRead: async (file: TFile) => contents[file.path] ?? "",
    },
  } as unknown as App;
}

describe("searchByName", () => {
  it("ranks an exact name above a prefix, a substring and a path hit", () => {
    const app = makeApp([
      makeFile("Notes/replan.md"),
      makeFile("plan.md"),
      makeFile("Notes/plans.md"),
      makeFile("plan/other.md"),
    ]);
    // Exact 100, prefix 80, substring 60, path-only 40.
    expect(searchByName(app, "plan").map(r => r.path))
      .toEqual(["plan.md", "Notes/plans.md", "Notes/replan.md", "plan/other.md"]);
  });

  it("honours the scope filter and the limit", () => {
    const app = makeApp([makeFile("Public/plan.md"), makeFile("Private/plan.md")]);
    expect(searchByName(app, "plan", 10, file => file.path.startsWith("Public/")).map(r => r.path))
      .toEqual(["Public/plan.md"]);
    expect(searchByName(app, "plan", 1)).toHaveLength(1);
  });
});

describe("searchByContent", () => {
  it("reads a PDF's extracted text, since PDFs are listed and matched by name", () => {
    // Searching only text files left the model told a PDF exists and unable to
    // find anything in it.
    const app = makeApp([makeFile("Public/report.pdf"), makeFile("Public/notes.md")], [], {
      "Public/notes.md": "nothing here",
    });
    return expect(searchByContent(app, "revenue").then(r => r.map(x => x.path)))
      .resolves.toEqual(["Public/report.pdf"]);
  });

  it("scores by occurrence count and returns a snippet around the first hit", async () => {
    const app = makeApp([makeFile("a.md"), makeFile("b.md")], [], {
      "a.md": "alpha beta alpha",
      "b.md": "alpha once",
    });
    const results = await searchByContent(app, "alpha");
    expect(results.map(r => r.path)).toEqual(["a.md", "b.md"]);
    expect(results[0].score).toBe(20);
    expect(results[0].matchedContent).toContain("alpha beta alpha");
  });

  it("skips a PDF whose text cannot be extracted", async () => {
    const app = makeApp([makeFile("Private/scan.pdf")]);
    expect(await searchByContent(app, "anything")).toEqual([]);
  });
});

describe("listNotes", () => {
  it("lists PDFs alongside text files, but not what no tool can read", () => {
    const app = makeApp([
      makeFile("Docs/note.md", 2),
      makeFile("Docs/report.pdf", 1),
      makeFile("Docs/photo.png", 3),
    ]);
    expect(listNotes(app, "Docs").results.map(r => r.path)).toEqual(["Docs/note.md", "Docs/report.pdf"]);
  });

  it("lists a folder's own files, newest first, and reports what it cut", () => {
    const app = makeApp([
      makeFile("Notes/old.md", 1),
      makeFile("Notes/new.md", 3),
      makeFile("Notes/sub/deep.md", 2),
      makeFile("Other/x.md", 4),
    ]);
    const shallow = listNotes(app, "Notes", false, 10);
    expect(shallow.results.map(r => r.path)).toEqual(["Notes/new.md", "Notes/old.md"]);

    const capped = listNotes(app, "Notes", true, 1);
    expect(capped.results.map(r => r.path)).toEqual(["Notes/new.md"]);
    expect(capped).toMatchObject({ totalCount: 3, hasMore: true });
  });
});

describe("listFolders", () => {
  it("lists descendants of a parent, excluding the parent itself", () => {
    const app = makeApp([], [makeFolder("Public"), makeFolder("Public/Docs"), makeFolder("Private")]);
    expect(listFolders(app, "Public")).toEqual(["Public/Docs"]);
    expect(listFolders(app).sort()).toEqual(["Private", "Public", "Public/Docs"]);
  });

  it("applies the scope filter the vault tools pass in", () => {
    const app = makeApp([], [makeFolder("Public"), makeFolder("Private")]);
    expect(listFolders(app, undefined, path => path === "Public")).toEqual(["Public"]);
  });
});
