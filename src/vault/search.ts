import { TFile, TFolder, type App } from "obsidian";
import { formatError } from "../core/error.js";
import { getSearchableVaultFiles } from "./fileTypes.js";
import { extractPdfText } from "./pdfText.js";

/** Default for listNotes, matching what the hosts configure. */
export const DEFAULT_LIST_NOTES_LIMIT = 50;

export interface SearchResult {
  path: string;
  name: string;
  score: number;
  matchedContent?: string;
}

function candidates(app: App, fileFilter?: (file: TFile) => boolean): TFile[] {
  const files = getSearchableVaultFiles(app);
  return fileFilter ? files.filter(fileFilter) : files;
}

/** Rank files by how closely their name matches, best first. */
export function searchByName(
  app: App,
  query: string,
  limit = 10,
  fileFilter?: (file: TFile) => boolean,
): SearchResult[] {
  const searchTerm = query.toLowerCase().trim();
  const results: SearchResult[] = [];

  for (const file of candidates(app, fileFilter)) {
    const fileName = file.basename.toLowerCase();
    const filePath = file.path.toLowerCase();

    let score = 0;
    if (fileName === searchTerm) score = 100;
    else if (fileName.startsWith(searchTerm)) score = 80;
    else if (fileName.includes(searchTerm)) score = 60;
    else if (filePath.includes(searchTerm)) score = 40;

    if (score > 0) results.push({ path: file.path, name: file.basename, score });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Rank files by how often the query appears in them, with a snippet around the
 * first hit. PDFs are read through their extracted text: they are listed and
 * matched by name, so skipping their contents would leave the model told a PDF
 * exists and unable to find anything in it.
 */
export async function searchByContent(
  app: App,
  query: string,
  limit = 10,
  fileFilter?: (file: TFile) => boolean,
): Promise<SearchResult[]> {
  const searchTerm = query.toLowerCase().trim();
  const results: SearchResult[] = [];

  for (const file of candidates(app, fileFilter)) {
    let content: string | null;
    if (file.extension === "pdf") {
      content = await extractPdfText(app, file.path);
      if (!content) continue;
    } else {
      content = await app.vault.cachedRead(file);
    }
    const contentLower = content.toLowerCase();

    const index = contentLower.indexOf(searchTerm);
    if (index === -1) continue;

    const start = Math.max(0, index - 50);
    const end = Math.min(content.length, index + searchTerm.length + 50);
    const occurrences = (contentLower.match(new RegExp(escapeRegex(searchTerm), "gi")) || []).length;

    results.push({
      path: file.path,
      name: file.basename,
      score: Math.min(occurrences * 10, 100),
      matchedContent: `...${content.slice(start, end)}...`,
    });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Files in a folder, newest first and capped, so a large vault cannot flood the context. */
export function listNotes(
  app: App,
  folder?: string,
  recursive = false,
  limit = DEFAULT_LIST_NOTES_LIMIT,
  fileFilter?: (file: TFile) => boolean,
): { results: SearchResult[]; totalCount: number; hasMore: boolean } {
  // PDFs are searchable by name and by content, so hiding them here would leave
  // the model finding files it can never list.
  let files = candidates(app, fileFilter);

  if (folder) {
    const normalizedFolder = folder.toLowerCase().replace(/\/$/, "");
    files = files.filter((file) => {
      const filePath = file.path.toLowerCase();
      if (recursive) return filePath.startsWith(`${normalizedFolder}/`);
      return (file.parent?.path?.toLowerCase() || "") === normalizedFolder;
    });
  }

  const totalCount = files.length;
  const sortedFiles = files.sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, limit);

  return {
    results: sortedFiles.map((file) => ({ path: file.path, name: file.basename, score: 0 })),
    totalCount,
    hasMore: totalCount > limit,
  };
}

/** Folder paths under `parentFolder`, or the whole vault. `folderFilter` applies the tool scope. */
export function listFolders(
  app: App,
  parentFolder?: string,
  folderFilter?: (path: string) => boolean,
): string[] {
  const folders = app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder);

  let filteredFolders = folders;
  if (parentFolder) {
    const normalizedParent = parentFolder.toLowerCase().replace(/\/$/, "");
    filteredFolders = folders.filter((f) => {
      const folderPath = f.path.toLowerCase();
      return folderPath.startsWith(`${normalizedParent}/`) && folderPath !== normalizedParent;
    });
  }

  return filteredFolders
    .map((f) => f.path)
    .filter((path) => path !== "/" && (!folderFilter || folderFilter(path)));
}

export async function createFolder(
  app: App,
  path: string,
): Promise<{ success: boolean; path?: string; error?: string }> {
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFolder) return { success: true, path };

  try {
    await app.vault.createFolder(path);
    return { success: true, path };
  } catch (error) {
    return { success: false, error: `Failed to create folder: ${formatError(error)}` };
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
