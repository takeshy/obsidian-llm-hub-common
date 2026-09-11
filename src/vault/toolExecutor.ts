import type { App, TFile } from "obsidian";
import {
  VAULT_TOOL_SCOPE_DENIED_MSG,
  isFileAllowedForVaultTools,
  isPathInAllowedVaultFolders,
  isPathNavigableForVaultTools,
} from "../core/vaultScope.js";
import { formatError } from "../core/error.js";
import {
  DEFAULT_MAX_NOTE_CHARS,
  applyDelete,
  applyEdit,
  createNote,
  deleteNote,
  discardDelete,
  discardEdit,
  findFileByName,
  findReadableFileByName,
  getActiveNoteInfo,
  proposeBulkDelete,
  proposeBulkEdit,
  proposeBulkRename,
  proposeDelete,
  proposeEdit,
  proposeRename,
  readNote,
  readNoteContext,
  updateNote,
  type PdfInputMode,
} from "./notes.js";
import {
  DEFAULT_LIST_NOTES_LIMIT,
  createFolder,
  listFolders,
  listNotes,
  searchByContent,
  searchByName,
} from "./search.js";
import { readTimelineEntriesForDay, sanitizeTimelineName } from "./timelineReader.js";

export type VaultToolResult = Record<string, unknown>;

/**
 * What the built-in Vault tools need to know about the chat that called them.
 * Hosts may extend this; the executor reads only these fields and passes the
 * rest through to `executeHostTool`.
 */
export interface VaultToolExecutionContext {
  listNotesLimit?: number;
  maxNoteChars?: number;
  /** Confine the tools to `vaultToolAllowedFolders`. Both are required to take effect. */
  limitVaultToolScope?: boolean;
  vaultToolAllowedFolders?: string[];
  /**
   * "native" sends a PDF to the model as a document part; the caller must lift
   * it out of the tool result before serializing.
   */
  pdfInputMode?: PdfInputMode;
}

export interface VaultToolExecutorOptions<C extends VaultToolExecutionContext> {
  /**
   * Tools this host adds beyond the built-in set. Return null to fall through
   * to "Unknown tool", so a name neither side knows is still reported as such.
   */
  executeHostTool?(
    app: App,
    toolName: string,
    args: Record<string, unknown>,
    context: C | undefined,
  ): Promise<VaultToolResult | null>;
}

function hasScope(context: VaultToolExecutionContext | undefined): boolean {
  return !!(context?.limitVaultToolScope && context.vaultToolAllowedFolders?.length);
}

function allowedFolders(context: VaultToolExecutionContext | undefined): string[] | undefined {
  return hasScope(context) ? context?.vaultToolAllowedFolders : undefined;
}

function deny(): VaultToolResult {
  return { success: false, error: VAULT_TOOL_SCOPE_DENIED_MSG };
}

/** A bulk call names every entry it refused, so the model can retry with the rest. */
function denyBulk(rejectedPaths: string[]): VaultToolResult {
  return { success: false, error: VAULT_TOOL_SCOPE_DENIED_MSG, rejectedPaths };
}

function fileFilter(context: VaultToolExecutionContext | undefined): ((file: TFile) => boolean) | undefined {
  if (!hasScope(context)) return undefined;
  return (file) => isFileAllowedForVaultTools(file, context?.vaultToolAllowedFolders);
}

/**
 * Ancestors of an allowed folder are listed so the user can navigate to one.
 * They never authorize reading a file, which goes through isFileAllowedForVaultTools.
 */
function folderFilter(context: VaultToolExecutionContext | undefined): ((path: string) => boolean) | undefined {
  if (!hasScope(context)) return undefined;
  return (path) => isPathNavigableForVaultTools(path, context?.vaultToolAllowedFolders);
}

/**
 * Whether the file a tool will act on is inside the scope.
 *
 * The lookup must be the one the tool itself uses — read tools accept PDFs,
 * writing tools do not — or the guard checks one file and the tool touches
 * another. A name that resolves to nothing is left to the tool, which reports
 * that it could not find it; refusing here would answer "access denied" for a
 * file that does not exist.
 */
function isFileInScope(
  app: App,
  fileName: string | undefined,
  activeNote: boolean | undefined,
  context: VaultToolExecutionContext | undefined,
  readOnly = false,
): boolean {
  if (!hasScope(context)) return true;
  const lookup = readOnly ? findReadableFileByName : findFileByName;
  const file = activeNote ? app.workspace.getActiveFile() : fileName ? lookup(app, fileName) : null;
  if (!file) return true;
  return isFileAllowedForVaultTools(file, context?.vaultToolAllowedFolders);
}

function isPathInScope(path: string | undefined, context: VaultToolExecutionContext | undefined): boolean {
  if (!hasScope(context)) return true;
  return !!path && isPathInAllowedVaultFolders(path, context?.vaultToolAllowedFolders);
}

/** Coerce a model-provided argument to a string; models send numbers for string fields. */
function asString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try { return JSON.stringify(value); } catch { return undefined; }
}

/** NaN for a value that is not a whole number, so the caller can reject it. */
function asPageNumber(value: unknown): number | undefined {
  if (value == null) return undefined;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) ? number : Number.NaN;
}

const asInteger = asPageNumber;

function localDay(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parsePositiveLimit(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = parseInt(asString(value) || String(fallback), 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
}

/** Run one built-in Vault tool, reporting a thrown error rather than propagating it. */
export async function executeVaultTool<C extends VaultToolExecutionContext = VaultToolExecutionContext>(
  app: App,
  toolName: string,
  args: Record<string, unknown>,
  context?: C,
  options: VaultToolExecutorOptions<C> = {},
): Promise<VaultToolResult> {
  try {
    return await run(app, toolName, args, context, options);
  } catch (error) {
    return { success: false, error: formatError(error), toolName };
  }
}

async function run<C extends VaultToolExecutionContext>(
  app: App,
  toolName: string,
  args: Record<string, unknown>,
  context: C | undefined,
  options: VaultToolExecutorOptions<C>,
): Promise<VaultToolResult> {
  switch (toolName) {
    case "read_timeline": {
      const timelineName = sanitizeTimelineName(asString(args.timelineName) || "Timeline");
      const date = asString(args.date) || localDay();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return { success: false, error: "date must use YYYY-MM-DD format" };
      }
      if (!isPathInScope(`Dashboards/Timeline/${timelineName}`, context)) return deny();
      const entries = await readTimelineEntriesForDay(app.vault, timelineName, date);
      return {
        success: true,
        timelineName,
        date,
        count: entries.length,
        content: entries.join("\n\n---\n\n"),
      };
    }

    case "read_note": {
      const fileName = asString(args.fileName);
      const startPage = asPageNumber(args.startPage);
      const endPage = asPageNumber(args.endPage);
      const startLine = asInteger(args.startLine);
      const endLine = asInteger(args.endLine);
      if ((startPage !== undefined && (Number.isNaN(startPage) || startPage < 1))
        || (endPage !== undefined && (Number.isNaN(endPage) || endPage < 1))) {
        return { success: false, error: "startPage and endPage must be positive integers" };
      }
      if (startPage !== undefined && endPage !== undefined && startPage > endPage) {
        return { success: false, error: "startPage must be less than or equal to endPage" };
      }
      if ((startLine !== undefined && (Number.isNaN(startLine) || startLine < 1))
        || (endLine !== undefined && (Number.isNaN(endLine) || endLine < 1))) {
        return { success: false, error: "startLine and endLine must be positive integers" };
      }
      if (startLine !== undefined && endLine !== undefined && startLine > endLine) {
        return { success: false, error: "startLine must be less than or equal to endLine" };
      }
      if ((startPage !== undefined || endPage !== undefined) && (startLine !== undefined || endLine !== undefined)) {
        return { success: false, error: "Page and line ranges cannot be used together" };
      }
      if (!isFileInScope(app, fileName, args.activeNote as boolean | undefined, context, true)) return deny();
      return readNote(
        app,
        fileName,
        args.activeNote as boolean | undefined,
        context?.maxNoteChars ?? DEFAULT_MAX_NOTE_CHARS,
        context?.pdfInputMode ?? "extract-text",
        startPage,
        endPage,
        startLine,
        endLine,
      );
    }

    case "read_note_context": {
      const fileName = asString(args.fileName);
      const searchTerm = asString(args.searchTerm);
      const linesBefore = args.linesBefore == null ? 2 : asInteger(args.linesBefore);
      const linesAfter = args.linesAfter == null ? 2 : asInteger(args.linesAfter);
      if (!searchTerm) return { success: false, error: "searchTerm is required" };
      if (linesBefore === undefined || linesAfter === undefined || Number.isNaN(linesBefore) || Number.isNaN(linesAfter) || linesBefore < 0 || linesAfter < 0) {
        return { success: false, error: "linesBefore and linesAfter must be non-negative integers" };
      }
      if (!isFileInScope(app, fileName, args.activeNote as boolean | undefined, context, true)) return deny();
      return readNoteContext(app, fileName, args.activeNote as boolean | undefined, searchTerm, linesBefore, linesAfter);
    }

    case "create_note": {
      let name = asString(args.name);
      let folder = asString(args.folder);
      if (!name && args.path) {
        // Models sometimes send a single path where the schema asks for a name
        // and a folder; splitting it is friendlier than refusing the call.
        const pathStr = asString(args.path) || "";
        const lastSlash = pathStr.lastIndexOf("/");
        if (lastSlash >= 0) {
          name = pathStr.slice(lastSlash + 1);
          folder = folder ?? pathStr.slice(0, lastSlash);
        } else {
          name = pathStr;
        }
      }
      if (!name) return { success: false, error: "Required parameter 'name' is missing" };
      if (args.content == null) return { success: false, error: "Required parameter 'content' is missing" };
      if (!isPathInScope(folder ? `${folder}/${name}` : name, context)) return deny();
      return createNote(app, name, asString(args.content) || "", folder, asString(args.tags));
    }

    case "update_note": {
      const fileName = asString(args.fileName);
      if (!isFileInScope(app, fileName, args.activeNote as boolean | undefined, context)) return deny();
      return updateNote(
        app,
        fileName,
        args.activeNote as boolean | undefined,
        asString(args.newContent),
        (asString(args.mode) as "replace" | "append" | "prepend") || "replace",
      );
    }

    case "delete_note": {
      const fileName = asString(args.fileName);
      if (!fileName) return { success: false, error: "Required parameter 'fileName' is missing" };
      if (!isFileInScope(app, fileName, false, context)) return deny();
      return deleteNote(app, fileName);
    }

    case "rename_note": {
      const oldPath = asString(args.oldPath);
      const newPath = asString(args.newPath);
      if (!oldPath) return { success: false, error: "Required parameter 'oldPath' is missing" };
      if (!newPath) return { success: false, error: "Required parameter 'newPath' is missing" };
      if (!isFileInScope(app, oldPath, false, context) || !isPathInScope(newPath, context)) return deny();
      return proposeRename(app, oldPath, newPath);
    }

    case "search_notes": {
      const query = asString(args.query);
      if (!query) return { success: false, error: "Required parameter 'query' is missing" };
      const limit = parsePositiveLimit(args.limit, 10);

      if (args.searchContent as boolean | undefined) {
        const results = await searchByContent(app, query, limit, fileFilter(context));
        return {
          success: true,
          results: results.map((r) => ({ name: r.name, path: r.path, matchedContent: r.matchedContent })),
          count: results.length,
        };
      }
      const results = searchByName(app, query, limit, fileFilter(context));
      return {
        success: true,
        results: results.map((r) => ({ name: r.name, path: r.path })),
        count: results.length,
      };
    }

    case "list_notes": {
      const folder = asString(args.folder);
      const defaultLimit = context?.listNotesLimit ?? DEFAULT_LIST_NOTES_LIMIT;
      const limit = parsePositiveLimit(args.limit, defaultLimit);
      if (folder && !isPathInScope(folder, context)) return deny();
      const { results, totalCount, hasMore } = listNotes(
        app,
        folder,
        args.recursive as boolean | undefined,
        limit,
        fileFilter(context),
      );
      return {
        success: true,
        notes: results.map((r) => ({ name: r.name, path: r.path })),
        count: results.length,
        totalCount,
        hasMore,
        message: hasMore
          ? `Showing ${results.length} of ${totalCount} files. Use 'limit' parameter to see more.`
          : undefined,
      };
    }

    case "list_folders": {
      const parentFolder = asString(args.parentFolder);
      const filter = folderFilter(context);
      // The folder asked about is judged by the same rule as the ones listed,
      // or the tool lists an ancestor it then refuses to be asked about.
      if (parentFolder && filter && !filter(parentFolder)) return deny();
      const folders = listFolders(app, parentFolder, filter);
      return { success: true, folders, count: folders.length };
    }

    case "create_folder": {
      const path = asString(args.path);
      if (!path) return { success: false, error: "Required parameter 'path' is missing" };
      if (!isPathInScope(path, context)) return deny();
      return createFolder(app, path);
    }

    case "get_active_note_info": {
      if (!isFileInScope(app, undefined, true, context)) return deny();
      const info = getActiveNoteInfo(app);
      if (info) return { success: true, ...info };
      return { success: false, error: "No active vault file found. Please open a file first." };
    }

    case "propose_edit": {
      const fileName = asString(args.fileName);
      if (!isFileInScope(app, fileName, args.activeNote as boolean | undefined, context)) return deny();
      return proposeEdit(
        app,
        fileName,
        args.activeNote as boolean | undefined,
        asString(args.newContent),
        (asString(args.mode) as "replace" | "append" | "prepend" | "patch") || "replace",
        undefined,
        args.patches as Array<{ search: string; replace: string }> | undefined,
      );
    }

    case "apply_edit":
      return applyEdit(app);

    case "discard_edit":
      return discardEdit(app);

    case "propose_delete": {
      const fileName = asString(args.fileName);
      if (!fileName) return { success: false, error: "Required parameter 'fileName' is missing" };
      if (!isFileInScope(app, fileName, false, context)) return deny();
      return proposeDelete(app, fileName);
    }

    case "apply_delete":
      return applyDelete(app);

    case "discard_delete":
      return discardDelete(app);

    case "bulk_propose_edit": {
      const edits = args.edits as Array<{ fileName: string; newContent: string; mode?: "replace" | "append" | "prepend" }>;
      if (!Array.isArray(edits) || edits.length === 0) {
        return { success: false, error: "No edits provided. The 'edits' array is required." };
      }
      const rejected = edits
        .filter((edit) => !isFileInScope(app, edit.fileName, false, context))
        .map((edit) => edit.fileName);
      if (rejected.length > 0) return denyBulk(rejected);
      return proposeBulkEdit(app, edits);
    }

    case "bulk_propose_rename": {
      const renames = args.renames as Array<{ oldPath: string; newPath: string }>;
      if (!Array.isArray(renames) || renames.length === 0) {
        return { success: false, error: "No renames provided. The 'renames' array is required." };
      }
      const rejected = renames
        .filter((rename) => !isFileInScope(app, rename.oldPath, false, context) || !isPathInScope(rename.newPath, context))
        .flatMap((rename) => [rename.oldPath, rename.newPath]);
      if (rejected.length > 0) return denyBulk(rejected);
      return proposeBulkRename(app, renames);
    }

    case "bulk_propose_delete": {
      const fileNames = args.fileNames as string[];
      if (!Array.isArray(fileNames) || fileNames.length === 0) {
        return { success: false, error: "No files provided. The 'fileNames' array is required." };
      }
      const rejected = fileNames.filter((fileName) => !isFileInScope(app, fileName, false, context));
      if (rejected.length > 0) return denyBulk(rejected);
      return proposeBulkDelete(app, fileNames);
    }

    default: {
      const hostResult = await options.executeHostTool?.(app, toolName, args, context);
      if (hostResult) return hostResult;
      return { success: false, error: `Unknown tool: ${toolName}` };
    }
  }
}

/** The executor a provider calls, bound to one app, context and host extension. */
export function createVaultToolExecutor<C extends VaultToolExecutionContext = VaultToolExecutionContext>(
  app: App,
  context?: C,
  options: VaultToolExecutorOptions<C> = {},
): (name: string, args: Record<string, unknown>) => Promise<unknown> {
  return (name, args) => executeVaultTool(app, name, args, context, options);
}

/** Built-in tool names, so a host can tell its own additions apart. */
export const BUILT_IN_VAULT_TOOL_NAMES: readonly string[] = [
  "read_timeline", "read_note", "read_note_context", "create_note", "update_note", "delete_note", "rename_note",
  "search_notes", "list_notes", "list_folders", "create_folder", "get_active_note_info",
  "propose_edit", "apply_edit", "discard_edit", "propose_delete", "apply_delete", "discard_delete",
  "bulk_propose_edit", "bulk_propose_rename", "bulk_propose_delete",
];
