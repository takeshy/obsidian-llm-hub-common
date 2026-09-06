import { MarkdownView, type App, type TFile } from "obsidian";
import { findFileMentionOccurrences } from "../core/mentionResolver.js";
import { isFileAllowedForVaultTools } from "../core/vaultScope.js";

/** Where the {selection} variable can come from, in the order the chat prefers them. */
export interface CommandVariableSources {
  /** A selection handed in from outside the editor (a command, another view), consumed once. */
  takeExternalSelection(): { text: string; sourcePath?: string } | null;
  /** The last selection captured before focus moved to the chat. */
  getLastSelection(): string;
  getSelectionLocation(): { filePath: string; startLine: number; endLine: number } | null;
}

/**
 * Expands {content} and {selection} in a slash command or message. {selection} falls back to the
 * active note when nothing is selected, so a command always has something to work with.
 */
export async function resolveCommandVariables(
  app: App,
  template: string,
  sources: CommandVariableSources,
): Promise<string> {
	let result = template;

	// Resolve {content} - active note content with file info
	if (result.includes("{content}")) {
		const activeFile = app.workspace.getActiveFile();
		if (activeFile) {
			const content = await app.vault.read(activeFile);
			const contentText = `From "${activeFile.path}":\n${content}`;
			result = result.replace(/\{content\}/g, contentText);
		} else {
			result = result.replace(/\{content\}/g, "[No active note]");
		}
	}

	// Resolve {selection} - selected text in editor with optional location info
	// Falls back to {content} if no selection
	if (result.includes("{selection}")) {
		let selection = "";
		let locationInfo: { filePath: string; startLine: number; endLine: number } | null = null;
		const externalSelection = sources.takeExternalSelection();

		if (externalSelection?.text) {
			selection = externalSelection.text;
			if (externalSelection.sourcePath) {
				locationInfo = {
					filePath: externalSelection.sourcePath,
					startLine: 0,
					endLine: 0,
				};
			}
		}

		// First try to get selection from current active view
		const activeView = selection ? null : app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView) {
			const editor = activeView.editor;
			selection = editor.getSelection();
			if (selection && activeView.file) {
				const fromPos = editor.getCursor("from");
				const toPos = editor.getCursor("to");
				locationInfo = {
					filePath: activeView.file.path,
					startLine: fromPos.line + 1,
					endLine: toPos.line + 1,
				};
			}
		}

		// Fallback to cached selection (captured before focus changed to chat)
		if (!selection) {
			selection = sources.getLastSelection();
			locationInfo = sources.getSelectionLocation();
		}

		// Build selection text with location info
		let selectionText: string;
		if (selection && locationInfo) {
			const lineInfo = locationInfo.startLine > 0
				? (locationInfo.startLine === locationInfo.endLine
					? ` (Line ${locationInfo.startLine})`
					: ` (Lines ${locationInfo.startLine}-${locationInfo.endLine})`)
				: "";
			// Format as quote block for clear boundary
			const quotedSelection = selection.split("\n").map(line => `> ${line}`).join("\n");
			selectionText = `From "${locationInfo.filePath}"${lineInfo}:\n${quotedSelection}`;
		} else if (selection) {
			const quotedSelection = selection.split("\n").map(line => `> ${line}`).join("\n");
			selectionText = `Selected text:\n${quotedSelection}`;
		} else {
			// Fallback to active note content if no selection
			const activeFile = app.workspace.getActiveFile();
			if (activeFile) {
				const content = await app.vault.read(activeFile);
				selectionText = `From "${activeFile.path}":\n${content}`;
			} else {
				selectionText = "[No selection or active note]";
			}
		}

		result = result.replace(/\{selection\}/g, selectionText);
	}

	return result;
}

// Files that can be @-mentioned: Markdown plus PDFs (text layer extracted on demand).
// Extensions are compared lower-cased to match the vault-layer lookups.
const MENTIONABLE_EXTENSIONS = new Set(["md", "pdf"]);

export function isMentionableFile(file: TFile): boolean {
  return MENTIONABLE_EXTENSIONS.has(file.extension.toLowerCase());
}

// File mentions stay as bare vault paths whenever the model has vault tools
// (see resolveMessageVariables), so it has to fetch their contents itself.
export const FILE_MENTION_TOOL_PROMPT =
  "\n\nA bare vault-relative path in the user's message (for example `folder/note.md` or `folder/document.pdf`) is a file the user referenced by mention, not a literal string. Its content is not inlined into the message. Call read_note with that exact path before answering anything that depends on it.";

export interface MessageVariableOptions extends CommandVariableSources {
  /**
   * False when the model has vault tools and can fetch mentions itself. Files the tools
   * cannot reach (outside the configured scope) are still inlined.
   */
  inlineFileMentions: boolean;
  /** Folders the vault tools are limited to, from settings; empty means the whole vault. */
  vaultToolAllowedFolders?: string[];
  /** 0 or less means "no limit". */
  maxNoteChars: number;
  /** Reads a mentionable file's text; null means "no extractable text" (e.g. a scanned PDF). */
  readMentionText(file: TFile): Promise<string | null>;
}

/**
 * Expands {content}/{selection} and then splices in the text of @-mentioned files the model
 * cannot read for itself.
 */
export async function resolveMessageVariables(
  app: App,
  content: string,
  options: MessageVariableOptions,
): Promise<string> {
  let result = await resolveCommandVariables(app, content, options);
  const scopedFolders = options.vaultToolAllowedFolders;
  const vaultToolScopeLimited = (scopedFolders?.length ?? 0) > 0;
  if (!options.inlineFileMentions && !vaultToolScopeLimited) return result;

  const files = app.vault.getFiles().filter(isMentionableFile);
  const fileByPath = new Map<string, TFile>(files.map(f => [f.path, f]));
  const occurrences = findFileMentionOccurrences(
    result,
    files.map(f => f.path),
    { requireWhitespaceBoundary: true }
  );
  if (occurrences.length === 0) return result;

  interface Splice { start: number; end: number; replacement: string; }
  const splices: Splice[] = [];
  const hitsByPath = new Map<string, typeof occurrences>();
  for (const occ of occurrences) {
    const list = hitsByPath.get(occ.key) ?? [];
    list.push(occ);
    hitsByPath.set(occ.key, list);
  }
  for (const [path, hits] of hitsByPath) {
    const file = fileByPath.get(path);
    if (!file) continue;
    // With vault tools available the model fetches mentions via read_note, so
    // only inline what read_note is not allowed to reach.
    if (!options.inlineFileMentions && isFileAllowedForVaultTools(file, scopedFolders)) continue;
    try {
      const extracted = await options.readMentionText(file);
      // null means "no extractable text" (scan-only or unreadable PDF). Say so
      // instead of leaving a bare path the model cannot read and will guess at.
      if (extracted === null) {
        const marker = `\n\n[Could not extract text from "${path}"]\n\n`;
        for (const h of hits) {
          splices.push({ start: h.start, end: h.end, replacement: marker });
        }
        continue;
      }
      const maxChars = options.maxNoteChars;
      const fileContent = maxChars > 0 && extracted.length > maxChars
        ? `${extracted.slice(0, maxChars)}\n\n[Content truncated at ${maxChars} characters]`
        : extracted;
      const replacement = `\n\n--- Content of "${path}" ---\n${fileContent}\n--- End of "${path}" ---\n\n`;
      for (const h of hits) {
        splices.push({ start: h.start, end: h.end, replacement });
      }
    } catch {
      // File couldn't be read — leave the mention as-is.
    }
  }

  // Splice in reverse order so earlier offsets stay valid.
  splices.sort((a, b) => b.start - a.start);
  for (const s of splices) {
    result = result.slice(0, s.start) + s.replacement + result.slice(s.end);
  }

  return result;
}
