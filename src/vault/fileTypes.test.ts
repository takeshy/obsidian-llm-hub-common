import { describe, expect, it } from "vitest";
import { TFile } from "obsidian";
import {
  compareFileLookupPriority,
  ensureMarkdownExtensionIfMissing,
  getPathExtension,
  getReadableVaultFiles,
  getSearchableVaultFiles,
  hasExplicitExtension,
  isMarkdownPath,
  isReadableVaultFile,
  isVaultTextFile,
  normalizeLookupTerm,
  splitFileName,
} from "./fileTypes.js";

function file(path: string, extension: string) {
  return { path, extension } as never;
}

describe("vault file types", () => {
  it("keeps explicit non-markdown extensions", () => {
    expect(ensureMarkdownExtensionIfMissing("boards/diagram.canvas")).toBe("boards/diagram.canvas");
    expect(ensureMarkdownExtensionIfMissing("data/config.json")).toBe("data/config.json");
  });

  it("adds .md only when extension is missing", () => {
    expect(ensureMarkdownExtensionIfMissing("notes/today")).toBe("notes/today.md");
  });

  it("detects explicit extensions from the final path segment", () => {
    expect(hasExplicitExtension("folder.with.dot/file.canvas")).toBe(true);
    expect(hasExplicitExtension("folder.with.dot/file")).toBe(false);
  });

  it("normalizes supported text extensions for fuzzy lookup", () => {
    expect(normalizeLookupTerm("My Folder/Board.canvas")).toBe("my folder/board");
    expect(normalizeLookupTerm("Notes/Plan.md")).toBe("notes/plan");
    expect(normalizeLookupTerm("config.json")).toBe("config");
  });

  it("leaves unsupported extensions intact during lookup normalization", () => {
    expect(normalizeLookupTerm("archive.tar.gz")).toBe("archive.tar.gz");
  });

  it("splits file names into stem and extension", () => {
    expect(splitFileName("diagram.canvas")).toEqual({ stem: "diagram", extension: ".canvas" });
    expect(splitFileName("plain")).toEqual({ stem: "plain", extension: "" });
  });

  it("detects markdown paths for markdown-only behavior", () => {
    expect(getPathExtension("Notes/TODAY.MD")).toBe("md");
    expect(getPathExtension("boards/diagram.canvas")).toBe("canvas");
    expect(getPathExtension("folder.with.dot/file")).toBe("");
    expect(isMarkdownPath("Notes/TODAY.MD")).toBe(true);
    expect(isMarkdownPath("boards/diagram.canvas")).toBe(false);
  });

  it("prefers markdown files only for extensionless lookups", () => {
    const files = [
      file("Plan.canvas", "canvas"),
      file("Folder/Plan.md", "md"),
      file("Plan.json", "json"),
    ];

    expect([...files].sort((a, b) => compareFileLookupPriority(a, b, true)).map((f) => f.path)).toEqual([
      "Folder/Plan.md",
      "Plan.json",
      "Plan.canvas",
    ]);
    expect([...files].sort((a, b) => compareFileLookupPriority(a, b, false)).map((f) => f.path)).toEqual([
      "Plan.json",
      "Plan.canvas",
      "Folder/Plan.md",
    ]);
  });
});

function makeFile(path: string): TFile {
  const file = new TFile();
  const name = path.split("/").pop() ?? path;
  const lastDot = name.lastIndexOf(".");
  file.path = path;
  file.name = name;
  file.basename = lastDot > 0 ? name.slice(0, lastDot) : name;
  file.extension = lastDot > 0 ? name.slice(lastDot + 1) : "";
  return file;
}

describe("fileTypes", () => {
  it("recognizes text-based vault file extensions", () => {
    expect(isVaultTextFile(makeFile("Board.canvas"))).toBe(true);
    expect(isVaultTextFile(makeFile("View.base"))).toBe(true);
    expect(isVaultTextFile(makeFile("Workspace.dashboard"))).toBe(true);
    expect(isVaultTextFile(makeFile("Data.json"))).toBe(true);
    expect(isVaultTextFile(makeFile("Image.png"))).toBe(false);
  });

  it("adds .md only when the path has no explicit extension", () => {
    expect(ensureMarkdownExtensionIfMissing("Daily")).toBe("Daily.md");
    expect(ensureMarkdownExtensionIfMissing("Board.canvas")).toBe("Board.canvas");
  });

  it("checks markdown paths by extension", () => {
    expect(isMarkdownPath("Daily.md")).toBe(true);
    expect(isMarkdownPath("Board.canvas")).toBe(false);
  });

  it("splits file names without losing non-markdown extensions", () => {
    expect(splitFileName("Board.canvas")).toEqual({ stem: "Board", extension: ".canvas" });
    expect(splitFileName("Daily")).toEqual({ stem: "Daily", extension: "" });
  });

  it("normalizes known text extensions for lookup", () => {
    expect(normalizeLookupTerm("Folder/Board.canvas")).toBe("folder/board");
    expect(normalizeLookupTerm("Folder/Image.png")).toBe("folder/image.png");
  });
});
