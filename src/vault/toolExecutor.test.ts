import { describe, expect, it, vi } from "vitest";
import { App, TFile, TFolder } from "obsidian";
import { executeVaultTool } from "./toolExecutor.js";

vi.mock("./pdfText.js", () => ({ extractPdfText: vi.fn(async () => "extracted pdf text") }));

function makeFolder(path: string): TFolder {
  const folder = new TFolder();
  folder.path = path;
  folder.name = path.split("/").pop() ?? path;
  return folder;
}

function makeFile(path: string, content = ""): TFile {
  const file = new TFile();
  const name = path.split("/").pop() ?? path;
  const lastDot = name.lastIndexOf(".");
  file.path = path;
  file.name = name;
  file.basename = lastDot > 0 ? name.slice(0, lastDot) : name;
  file.extension = lastDot > 0 ? name.slice(lastDot + 1) : "";
  file.parent = path.includes("/") ? makeFolder(path.slice(0, path.lastIndexOf("/"))) : null;
  file.stat = { ctime: 1, mtime: 1, size: content.length };
  (file as TFile & { _content: string })._content = content;
  return file;
}

function makeApp(files: TFile[], activeFile: TFile | null = null): App {
  const folders = [makeFolder("Public"), makeFolder("Private"), makeFolder("Public/Nested")];
  return {
    vault: {
      getFiles: () => files,
      getMarkdownFiles: () => files.filter(file => file.extension === "md"),
      getAllLoadedFiles: () => [...folders, ...files],
      getAbstractFileByPath: (path: string) =>
        folders.find(folder => folder.path === path) ?? files.find(file => file.path === path) ?? null,
      read: async (file: TFile) => (file as TFile & { _content: string })._content,
      cachedRead: async (file: TFile) => (file as TFile & { _content: string })._content,
    },
    workspace: { getActiveFile: () => activeFile },
  } as unknown as App;
}

const scoped = (folders: string[]) => ({ limitVaultToolScope: true, vaultToolAllowedFolders: folders });

describe("vault tools without a folder scope", () => {
  it("reads Dashboard Hub Timeline activity through the dedicated tool", async () => {
    const app = makeApp([
      makeFile("Dashboards/Timeline/Timeline/2026-07-23.md", "2026-07-23T01:00:00.000Z\nid: memo-1\n\nMemo created"),
      makeFile("Dashboards/Timeline/Timeline/2026-07-30.md", "2026-07-23T02:00:00.000Z\nid: event-1\n\n<!-- calendar-event: 2026-07-30 -->\n> Planned review"),
    ]);

    const result = await executeVaultTool(app, "read_timeline", { date: "2026-07-23" });

    expect(result).toMatchObject({ success: true, count: 2 });
    expect(String(result.content)).toContain("Memo created");
    expect(String(result.content)).toContain("Planned review");
  });

  it("rejects a date the tool cannot interpret", async () => {
    expect(await executeVaultTool(makeApp([]), "read_timeline", { date: "23/07/2026" }))
      .toMatchObject({ success: false, error: expect.stringContaining("YYYY-MM-DD") });
  });

  it("reports an unknown tool rather than failing silently", async () => {
    expect(await executeVaultTool(makeApp([]), "make_coffee", {}))
      .toMatchObject({ success: false, error: "Unknown tool: make_coffee" });
  });

  it("validates the PDF page range read_note declares", async () => {
    const app = makeApp([makeFile("Public/report.pdf")]);

    expect(String((await executeVaultTool(app, "read_note", { fileName: "Public/report.pdf", startPage: 1.5 })).error))
      .toContain("positive integers");
    expect(String((await executeVaultTool(app, "read_note", { fileName: "Public/report.pdf", startPage: 7, endPage: 3 })).error))
      .toContain("less than or equal to");
  });

  it("passes text line ranges and validates context arguments", async () => {
    const app = makeApp([makeFile("Public/long.md", "one\ntwo\nthree")]);

    expect(await executeVaultTool(app, "read_note", { fileName: "Public/long.md", startLine: 2, endLine: 3 }))
      .toMatchObject({ success: true, content: "two\nthree", startLine: 2, endLine: 3, totalLines: 3 });
    expect(await executeVaultTool(app, "read_note_context", { fileName: "Public/long.md", searchTerm: "two", linesBefore: -1 }))
      .toMatchObject({ success: false, error: expect.stringContaining("non-negative integers") });
  });
});

describe("vault tool folder scope", () => {
  it("allows the whole vault when no folders are configured", async () => {
    const app = makeApp([makeFile("Private/Secret.md", "secret")]);

    expect(await executeVaultTool(app, "read_note", { fileName: "Private/Secret.md" }, scoped([])))
      .toMatchObject({ success: true, path: "Private/Secret.md" });
  });

  it("ignores the folder list until the caller opts in", async () => {
    const app = makeApp([makeFile("Private/Secret.md", "secret")]);

    expect(await executeVaultTool(app, "read_note", { fileName: "Private/Secret.md" }, {
      limitVaultToolScope: false,
      vaultToolAllowedFolders: ["Public"],
    })).toMatchObject({ success: true, path: "Private/Secret.md" });
  });

  it("blocks a read outside the configured folders", async () => {
    const app = makeApp([makeFile("Public/Note.md", "public"), makeFile("Private/Secret.md", "secret")]);

    expect(await executeVaultTool(app, "read_note", { fileName: "Private/Secret.md" }, scoped(["Public"])))
      .toMatchObject({ success: false, error: expect.stringContaining("Access denied") });
  });

  it("blocks a context read outside the configured folders", async () => {
    const app = makeApp([makeFile("Private/Secret.md", "needle")]);

    expect(await executeVaultTool(app, "read_note_context", { fileName: "Private/Secret.md", searchTerm: "needle" }, scoped(["Public"])))
      .toMatchObject({ success: false, error: expect.stringContaining("Access denied") });
  });

  it("blocks an out-of-scope PDF looked up by bare file name", async () => {
    const app = makeApp([makeFile("Public/Note.md", "public"), makeFile("Private/secret.pdf", "")]);

    expect(await executeVaultTool(app, "read_note", { fileName: "secret.pdf" }, scoped(["Public"])))
      .toMatchObject({ success: false, error: expect.stringContaining("Access denied") });
  });

  it("blocks a traversal path that would escape the configured folders", async () => {
    const app = makeApp([makeFile("Public/Note.md", "public"), makeFile("Private/Secret.md", "secret")]);

    expect(await executeVaultTool(app, "create_note", {
      name: "../Private/Secret.md", folder: "Public", content: "leak",
    }, scoped(["Public"]))).toMatchObject({ success: false, error: expect.stringContaining("Access denied") });
  });

  it("denies everything when every configured folder is unusable", async () => {
    // Returning "allowed" once nothing normalized turned a typo like "../notes"
    // into whole-vault access.
    const app = makeApp([makeFile("Private/Secret.md", "secret")]);

    expect(await executeVaultTool(app, "read_note", { fileName: "Private/Secret.md" }, scoped(["../escape"])))
      .toMatchObject({ success: false, error: expect.stringContaining("Access denied") });
  });

  it("treats folder names that differ only in case as different folders", async () => {
    const app = makeApp([makeFile("public/Note.md", "other")]);

    expect(await executeVaultTool(app, "read_note", { fileName: "public/Note.md" }, scoped(["Public"])))
      .toMatchObject({ success: false, error: expect.stringContaining("Access denied") });
  });

  it("filters search and listing results to the configured folders", async () => {
    const app = makeApp([
      makeFile("Public/Plan.md", "shared roadmap"),
      makeFile("Private/Plan.md", "private roadmap"),
      makeFile("Private/Other.md", "other"),
    ]);
    const context = scoped(["Public"]);

    expect((await executeVaultTool(app, "search_notes", { query: "Plan" }, context)).results)
      .toEqual([{ name: "Plan", path: "Public/Plan.md" }]);
    expect((await executeVaultTool(app, "list_notes", {}, context)).notes)
      .toEqual([{ name: "Plan", path: "Public/Plan.md" }]);
  });

  it("lists the ancestors needed to reach an allowed folder, and nothing beside them", async () => {
    const app = makeApp([]);

    expect((await executeVaultTool(app, "list_folders", {}, scoped(["Public/Nested"]))).folders)
      .toEqual(["Public", "Public/Nested"]);
  });

  it("answers about an ancestor it is willing to list", async () => {
    // Gating with the strict check while listing with the navigable one meant
    // the tool listed "Public" and then refused to be asked about it.
    const app = makeApp([]);

    expect(await executeVaultTool(app, "list_folders", { parentFolder: "Public" }, scoped(["Public/Nested"])))
      .toMatchObject({ success: true, folders: ["Public/Nested"] });
  });

  it("still refuses a folder that leads nowhere allowed", async () => {
    const app = makeApp([]);

    expect(await executeVaultTool(app, "list_folders", { parentFolder: "Private" }, scoped(["Public/Nested"])))
      .toMatchObject({ success: false, error: expect.stringContaining("Access denied") });
  });

  it("names every entry a bulk call refused, so the model can retry with the rest", async () => {
    const app = makeApp([makeFile("Public/Note.md", "public"), makeFile("Private/Secret.md", "secret")]);

    const result = await executeVaultTool(app, "bulk_propose_delete", {
      fileNames: ["Public/Note.md", "Private/Secret.md"],
    }, scoped(["Public"]));

    expect(result).toMatchObject({ success: false, error: expect.stringContaining("Access denied") });
    expect(result.rejectedPaths).toEqual(["Private/Secret.md"]);
  });

  it("reports a missing file as missing rather than as denied", async () => {
    // The guard and the tool resolve the target the same way, so a name the
    // guard cannot resolve is one the tool cannot either.
    const app = makeApp([makeFile("Public/Note.md", "public")]);

    expect(String((await executeVaultTool(app, "propose_edit", {
      fileName: "Nowhere.md", mode: "replace", newContent: "x",
    }, scoped(["Public"]))).error)).not.toContain("Access denied");
  });
});

describe("host tools", () => {
  it("passes a name the built-in set does not know to the host", async () => {
    const app = makeApp([]);
    const executeHostTool = vi.fn(async () => ({ success: true, from: "host" }));

    expect(await executeVaultTool(app, "get_rag_sync_status", { listAll: true }, undefined, { executeHostTool }))
      .toEqual({ success: true, from: "host" });
    expect(executeHostTool).toHaveBeenCalledWith(app, "get_rag_sync_status", { listAll: true }, undefined);
  });

  it("still reports a name neither side knows", async () => {
    const executeHostTool = vi.fn(async () => null);

    expect(await executeVaultTool(makeApp([]), "make_coffee", {}, undefined, { executeHostTool }))
      .toMatchObject({ success: false, error: "Unknown tool: make_coffee" });
  });
});
