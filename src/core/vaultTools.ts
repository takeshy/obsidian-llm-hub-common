import type { ToolDefinition } from "./provider.js";

/**
 * How much of the built-in Vault tool set a chat may reach.
 * - "all": every tool the host enabled
 * - "noSearch": everything except the vault-wide search/listing tools
 * - "readOnly": read tools only, no writes and no deletes
 * - "none": no built-in Vault tools at all
 */
export type VaultToolMode = "all" | "noSearch" | "readOnly" | "none";

/** Read-only tools. Available in every mode but "none". */
export const READ_ONLY_VAULT_TOOL_NAMES: readonly string[] = [
  "read_timeline",
  "read_note",
  "read_note_context",
  "search_notes",
  "list_notes",
  "list_folders",
  "get_active_note_info",
] as const;

/** Tools that scan the whole vault; dropped in "noSearch" mode. */
export const SEARCH_VAULT_TOOL_NAMES: readonly string[] = ["search_notes", "list_notes"] as const;

/** Tools that create or modify vault files; gated by `allowWrite`. */
export const WRITE_VAULT_TOOL_NAMES: readonly string[] = [
  "create_note",
  "create_folder",
  "rename_note",
  "propose_edit",
  "bulk_propose_edit",
  "bulk_propose_rename",
] as const;

/** Tools that remove vault files; gated by `allowDelete`. */
export const DELETE_VAULT_TOOL_NAMES: readonly string[] = ["propose_delete", "bulk_propose_delete"] as const;

/** Tools that need a RAG index tracking per-file sync state; gated by `ragSyncStatus`. */
export const RAG_VAULT_TOOL_NAMES: readonly string[] = ["get_rag_sync_status"] as const;

/**
 * Tools the executor still answers but that are never advertised: `update_note`
 * writes without a confirmation dialog (superseded by `propose_edit`) and
 * `delete_note` deletes without one (superseded by `propose_delete`). They stay
 * in the definitions so an older conversation replaying such a call still
 * resolves to a known tool rather than "Unknown tool".
 */
export const NEVER_ADVERTISED_VAULT_TOOL_NAMES: readonly string[] = ["update_note", "delete_note"] as const;

/**
 * Built-in Vault tool schemas, shared by every plugin so the same tool never
 * grows a parameter in one host and not another. Which of them a host actually
 * advertises is decided by `getEnabledVaultTools`.
 */
export const VAULT_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "read_timeline",
    description:
      "Read activity recorded by Dashboard Hub in an Obsidian Timeline for a day. Use this when asked what the user did today or on a specific date. Includes manual Timeline posts, Calendar plans created that day, memo activity, and Kanban status changes.",
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Local date in YYYY-MM-DD format. Defaults to today.",
        },
        timelineName: {
          type: "string",
          description: "Timeline name. Defaults to Timeline.",
        },
      },
    },
  },
  {
    name: "read_note",
    description:
      "Read a supported vault file in Obsidian by name or by detecting the currently active file. Text files can select an inclusive 1-based line range with startLine and endLine. PDFs can select pages with startPage and endPage.",
    parameters: {
      type: "object",
      properties: {
        fileName: {
          type: "string",
          description: "The name or path of the vault file to read",
        },
        activeNote: {
          type: "boolean",
          description:
            "If no filename provided, set to true to read the currently active note",
        },
        startPage: {
          type: "integer",
          description: "For PDFs, the 1-based first page to read (inclusive). Defaults to page 1.",
        },
        endPage: {
          type: "integer",
          description: "For PDFs, the 1-based last page to read (inclusive). Defaults to the final page.",
        },
        startLine: { type: "integer", description: "For text files, the 1-based first line to read (inclusive). Defaults to line 1." },
        endLine: { type: "integer", description: "For text files, the 1-based last line to read (inclusive). Defaults to the final line." },
      },
    },
  },
  {
    name: "read_note_context",
    description: "Find a literal search term in a text vault file and return the lines before and after every hit. Overlapping context windows are merged.",
    parameters: {
      type: "object",
      properties: {
        fileName: { type: "string", description: "The name or path of the text file to search" },
        activeNote: { type: "boolean", description: "If no filename is provided, search the active note" },
        searchTerm: { type: "string", description: "Case-insensitive literal text to find" },
        linesBefore: { type: "integer", description: "Number of lines before each hit. Defaults to 2." },
        linesAfter: { type: "integer", description: "Number of lines after each hit. Defaults to 2." },
      },
      required: ["searchTerm"],
    },
  },
  {
    name: "create_note",
    description:
      "Create a new text-based vault file in Obsidian with the specified content and optional location.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The file name or path. If no extension is provided, .md is added automatically.",
        },
        content: {
          type: "string",
          description: "The text content for the file (for example Markdown, Canvas JSON, Bases YAML, or plain text)",
        },
        folder: {
          type: "string",
          description: "The folder path where the note should be created",
        },
        tags: {
          type: "string",
          description: "Comma-separated list of tags to add to Markdown notes",
        },
      },
      required: ["name", "content"],
    },
  },
  {
    name: "update_note",
    description:
      "Update or replace the content of an existing text-based vault file in Obsidian.",
    parameters: {
      type: "object",
      properties: {
        fileName: {
          type: "string",
          description: "The name or path of the vault file to update",
        },
        activeNote: {
          type: "boolean",
          description: "If true, update the currently active note",
        },
        newContent: {
          type: "string",
          description: "The new content to replace or append",
        },
        mode: {
          type: "string",
          description: "Update mode: 'replace' to replace all content, 'append' to add at end, 'prepend' to add at beginning",
          enum: ["replace", "append", "prepend"],
        },
      },
      required: ["newContent"],
    },
  },
  {
    name: "search_notes",
    description:
      "Search text-based vault files by name or content. Returns matching file names.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query (file name pattern or content to search)",
        },
        searchContent: {
          type: "boolean",
          description: "If true, search within text file contents; if false, search file names only",
        },
        limit: {
          type: "string",
          description: "Maximum number of results to return (default: 10)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_notes",
    description:
      "List text-based vault files in a specific folder or the entire vault. Returns up to 'limit' files with total count.",
    parameters: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          description: "The folder path to list notes from. Leave empty for root.",
        },
        recursive: {
          type: "boolean",
          description: "If true, include notes in subfolders",
        },
        limit: {
          type: "string",
          description: "Maximum number of files to return (default: 50, configurable)",
        },
      },
    },
  },
  {
    name: "create_folder",
    description: "Create a new folder in the vault.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The path of the folder to create",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "list_folders",
    description: "List all folders in the vault.",
    parameters: {
      type: "object",
      properties: {
        parentFolder: {
          type: "string",
          description: "The parent folder to list subfolders from. Leave empty for all folders.",
        },
      },
    },
  },
  {
    name: "get_active_note_info",
    description:
      "Get information about the currently active vault file without reading its full content.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "delete_note",
    description: "Delete a text-based vault file.",
    parameters: {
      type: "object",
      properties: {
        fileName: {
          type: "string",
          description: "The name or path of the vault file to delete",
        },
      },
      required: ["fileName"],
    },
  },
  {
    name: "rename_note",
    description: "Propose renaming or moving a text-based vault file. Changes are NOT applied immediately - a confirmation dialog is shown first. The user must click Apply to rename, or Discard to cancel.",
    parameters: {
      type: "object",
      properties: {
        oldPath: {
          type: "string",
          description: "The current path of the vault file",
        },
        newPath: {
          type: "string",
          description: "The new path for the vault file",
        },
      },
      required: ["oldPath", "newPath"],
    },
  },
  {
    name: "get_rag_sync_status",
    description:
      "Get RAG synchronization status for files. Can check if specific files are synced, when they were imported, if there are differences from current content, and list unsynced files in a directory.",
    parameters: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description:
            "Path to a specific file to check sync status for. Returns import time, sync status, and diff status.",
        },
        directory: {
          type: "string",
          description:
            "Directory path to list unsynced files. Returns list of files that have not been imported to RAG or have changes.",
        },
        listAll: {
          type: "boolean",
          description:
            "If true, return sync status summary for all files in the vault.",
        },
      },
    },
  },
  {
    name: "propose_edit",
    description:
      "Propose an edit to an existing text-based vault file. Changes are NOT applied immediately - a confirmation dialog is shown first. The user must click Apply to write changes, or Discard to cancel. Use this instead of update_note for safer editing workflow.",
    parameters: {
      type: "object",
      properties: {
        fileName: {
          type: "string",
          description: "The name or path of the vault file to edit",
        },
        activeNote: {
          type: "boolean",
          description: "If true, edit the currently active note",
        },
        newContent: {
          type: "string",
          description: "The new content to propose (required for replace/append/prepend modes)",
        },
        mode: {
          type: "string",
          description: "Edit mode: 'replace' replaces all content (requires newContent), 'append' adds at end (requires newContent), 'prepend' adds at beginning (requires newContent), 'patch' applies search-and-replace patches (requires patches)",
          enum: ["replace", "append", "prepend", "patch"],
        },
        patches: {
          type: "array",
          description: "Array of search-and-replace patches (required for patch mode). Each patch replaces the first occurrence of 'search' with 'replace'.",
          items: {
            type: "object",
            properties: {
              search: {
                type: "string",
                description: "The text to search for (exact match)",
              },
              replace: {
                type: "string",
                description: "The replacement text",
              },
            },
            required: ["search", "replace"],
          },
        },
      },
      required: ["mode"],
    },
  },
  {
    name: "propose_delete",
    description:
      "Propose deletion of a text-based vault file. The file is NOT deleted immediately - a confirmation dialog is shown first. The user must click Delete to confirm, or Cancel to keep the file. Use this for safe deletion workflow.",
    parameters: {
      type: "object",
      properties: {
        fileName: {
          type: "string",
          description: "The name or path of the vault file to delete",
        },
      },
      required: ["fileName"],
    },
  },
  {
    name: "bulk_propose_edit",
    description:
      "Propose edits to multiple text-based vault files at once. A confirmation dialog shows all files with checkboxes for selective application. Use this when editing many files to avoid multiple individual confirmations.",
    parameters: {
      type: "object",
      properties: {
        edits: {
          type: "array",
          description: "Array of edit operations",
          items: {
            type: "object",
            properties: {
              fileName: {
                type: "string",
                description: "The name or path of the vault file to edit",
              },
              newContent: {
                type: "string",
                description: "The new content for the vault file",
              },
              mode: {
                type: "string",
                description: "Edit mode: 'replace', 'append', or 'prepend'",
                enum: ["replace", "append", "prepend"],
              },
            },
            required: ["fileName", "newContent"],
          },
        },
      },
      required: ["edits"],
    },
  },
  {
    name: "bulk_propose_rename",
    description:
      "Propose renaming/moving multiple text-based vault files at once. A confirmation dialog shows all renames with checkboxes for selective application. Use this when renaming many files to avoid multiple individual confirmations.",
    parameters: {
      type: "object",
      properties: {
        renames: {
          type: "array",
          description: "Array of rename operations",
          items: {
            type: "object",
            properties: {
              oldPath: {
                type: "string",
                description: "The current path of the vault file",
              },
              newPath: {
                type: "string",
                description: "The new path for the vault file",
              },
            },
            required: ["oldPath", "newPath"],
          },
        },
      },
      required: ["renames"],
    },
  },
  {
    name: "bulk_propose_delete",
    description:
      "Propose deletion of multiple text-based vault files at once. A confirmation dialog shows all files with checkboxes for selective deletion. Use this when deleting many files to avoid multiple individual confirmations.",
    parameters: {
      type: "object",
      properties: {
        fileNames: {
          type: "array",
          description: "Array of file names or paths to delete",
          items: {
            type: "string",
          },
        },
      },
      required: ["fileNames"],
    },
  },
];

/** Every built-in Vault tool name, advertised or not. */
export const VAULT_TOOL_NAMES: readonly string[] = VAULT_TOOL_DEFINITIONS.map(tool => tool.name);

/**
 * What the host can actually execute. Every field is required: a host that
 * gains or loses an executor has to say so here, so a tool is never advertised
 * to a model that would answer the call with "Unknown tool".
 */
export interface VaultToolCapabilities {
  /** Host executes the create/rename/propose_edit family. */
  allowWrite: boolean;
  /** Host executes propose_delete / bulk_propose_delete. */
  allowDelete: boolean;
  /**
   * Host executes `get_rag_sync_status`. Only a RAG index that records per-file
   * import state can answer it; hosts whose RAG store has no such state pass false.
   */
  ragSyncStatus: boolean;
}

/** The built-in Vault tools this host advertises, before the per-chat mode filter. */
export function getEnabledVaultTools(capabilities: VaultToolCapabilities): ToolDefinition[] {
  return VAULT_TOOL_DEFINITIONS.filter(tool => {
    if (READ_ONLY_VAULT_TOOL_NAMES.includes(tool.name)) return true;
    if (RAG_VAULT_TOOL_NAMES.includes(tool.name)) return capabilities.ragSyncStatus;
    if (WRITE_VAULT_TOOL_NAMES.includes(tool.name)) return capabilities.allowWrite;
    if (DELETE_VAULT_TOOL_NAMES.includes(tool.name)) return capabilities.allowDelete;
    // update_note / delete_note write without a confirmation dialog.
    return false;
  });
}

/**
 * Shared policy for built-in Vault tools. External MCP and skill tools keep
 * their own permissions and are not controlled by the Vault tools selector.
 */
export function isVaultToolAllowed(name: string, mode: VaultToolMode): boolean {
  if (!VAULT_TOOL_NAMES.includes(name)) return true;
  if (mode === "none") return false;
  if (mode === "noSearch") return !SEARCH_VAULT_TOOL_NAMES.includes(name);
  if (mode === "readOnly") return READ_ONLY_VAULT_TOOL_NAMES.includes(name);
  return true;
}

/** Apply the per-chat Vault access mode to a list of already-enabled tools. */
export function filterVaultToolsForMode<T extends Pick<ToolDefinition, "name">>(
  tools: T[],
  mode: VaultToolMode,
): T[] {
  if (mode === "all") return tools;
  return tools.filter(tool => isVaultToolAllowed(tool.name, mode));
}
