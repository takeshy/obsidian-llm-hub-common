import { describe, it, expect } from "vitest";
import { TFile } from "obsidian";
import {
  resolveCommandVariables,
  resolveMessageVariables,
  type CommandVariableSources,
  type MessageVariableOptions,
} from "./commandVariables.js";

function file(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.extension = path.split(".").pop() ?? "";
  f.name = path.split("/").pop() ?? "";
  f.basename = f.name.replace(/\.[^.]+$/, "");
  return f;
}

function makeApp(files: TFile[], contents: Record<string, string> = {}, activeFile: TFile | null = null) {
  return {
    workspace: {
      getActiveFile: () => activeFile,
      getActiveViewOfType: () => null,
    },
    vault: {
      getFiles: () => files,
      read: (f: TFile) => Promise.resolve(contents[f.path] ?? ""),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Stand-in for the parts of App these helpers touch.
  } as any;
}

const noSelection: CommandVariableSources = {
  takeExternalSelection: () => null,
  getLastSelection: () => "",
  getSelectionLocation: () => null,
};

function options(over: Partial<MessageVariableOptions> = {}): MessageVariableOptions {
  return {
    ...noSelection,
    inlineFileMentions: true,
    maxNoteChars: 0,
    readMentionText: () => Promise.resolve("body"),
    ...over,
  };
}

describe("resolveCommandVariables", () => {
  it("inlines the active note for {content}", async () => {
    const active = file("notes/a.md");
    const app = makeApp([active], { "notes/a.md": "hello" }, active);
    expect(await resolveCommandVariables(app, "x {content} y", noSelection))
      .toBe('x From "notes/a.md":\nhello y');
  });

  it("says so when there is no active note", async () => {
    expect(await resolveCommandVariables(makeApp([]), "{content}", noSelection))
      .toBe("[No active note]");
  });

  it("consumes an external selection and quotes it with its location", async () => {
    let taken = 0;
    const sources: CommandVariableSources = {
      ...noSelection,
      takeExternalSelection: () => { taken++; return { text: "line1\nline2", sourcePath: "notes/a.md" }; },
    };
    const result = await resolveCommandVariables(makeApp([]), "{selection}", sources);
    expect(taken).toBe(1);
    expect(result).toContain('From "notes/a.md"');
    expect(result).toContain("> line1\n> line2");
  });

  it("falls back to the cached selection with its line range", async () => {
    const sources: CommandVariableSources = {
      takeExternalSelection: () => null,
      getLastSelection: () => "picked",
      getSelectionLocation: () => ({ filePath: "notes/b.md", startLine: 3, endLine: 5 }),
    };
    expect(await resolveCommandVariables(makeApp([]), "{selection}", sources))
      .toBe('From "notes/b.md" (Lines 3-5):\n> picked');
  });
});

describe("resolveMessageVariables", () => {
  it("inlines a mentioned file's text", async () => {
    const app = makeApp([file("notes/a.md")]);
    const result = await resolveMessageVariables(app, "see notes/a.md please", options({
      readMentionText: () => Promise.resolve("BODY"),
    }));
    expect(result).toContain('--- Content of "notes/a.md" ---\nBODY');
  });

  it("truncates at maxNoteChars", async () => {
    const app = makeApp([file("notes/a.md")]);
    const result = await resolveMessageVariables(app, "notes/a.md", options({
      maxNoteChars: 4,
      readMentionText: () => Promise.resolve("0123456789"),
    }));
    expect(result).toContain("0123\n\n[Content truncated at 4 characters]");
  });

  it("marks a file with no extractable text instead of leaving a bare path", async () => {
    const app = makeApp([file("notes/scan.pdf")]);
    const result = await resolveMessageVariables(app, "notes/scan.pdf", options({
      readMentionText: () => Promise.resolve(null),
    }));
    expect(result.trim()).toBe('[Could not extract text from "notes/scan.pdf"]');
  });

  it("leaves mentions alone when the model can read them itself", async () => {
    const app = makeApp([file("notes/a.md")]);
    expect(await resolveMessageVariables(app, "notes/a.md", options({ inlineFileMentions: false })))
      .toBe("notes/a.md");
  });

  it("still inlines mentions the vault tools are not scoped to reach", async () => {
    const app = makeApp([file("public/a.md"), file("private/b.md")]);
    const result = await resolveMessageVariables(app, "public/a.md private/b.md", options({
      inlineFileMentions: false,
      vaultToolAllowedFolders: ["public"],
      readMentionText: (f) => Promise.resolve(`text of ${f.path}`),
    }));
    expect(result).toContain("public/a.md ");
    expect(result).not.toContain('Content of "public/a.md"');
    expect(result).toContain('--- Content of "private/b.md" ---\ntext of private/b.md');
  });

  it("ignores non-mentionable extensions", async () => {
    const app = makeApp([file("notes/a.png")]);
    expect(await resolveMessageVariables(app, "notes/a.png", options())).toBe("notes/a.png");
  });
});
