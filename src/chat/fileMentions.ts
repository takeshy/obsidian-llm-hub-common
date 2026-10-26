import { type App } from "obsidian";
import { findFileMentionOccurrences } from "../core/mentionResolver.js";
import { isFileAllowedForVaultTools } from "../core/vaultScope.js";
import { type Message } from "../core/message.js";
import {
  resolveCommandVariables,
  resolveFileMentionContent,
  type CommandVariableSources,
  type MessageVariableOptions,
} from "./commandVariables.js";

export function formatComposerMention(value: string, kind: "variable" | "mention" | "wikilink"): string {
  return kind === "variable" ? `${value} ` : `[[${value}]] `;
}

/** Copies for provider requests; display and saved messages retain their content. */
export function messagesForModel(messages: Message[]): Message[] {
  return messages.map(message => message.llmContent === undefined
    ? message
    : { ...message, content: message.llmContent });
}

function normalizeFileMentions(app: App, content: string): string {
  const sourcePath = app.workspace.getActiveFile()?.path ?? "";
  const wikilinks = content.replace(/\[\[([^\]\n]+)\]\]/g, (match, target: string) => {
    const linkpath = target.split("|")[0].split("#")[0];
    const file = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
    return file && /^(md|pdf)$/i.test(file.extension) ? ` ${file.path} ` : match;
  });
  const paths = app.vault.getFiles()
    .filter(file => /^(md|pdf)$/i.test(file.extension))
    .map(file => file.path);
  const mentions = findFileMentionOccurrences(wikilinks, paths, { prefix: "@" })
    .filter(hit => hit.start === 0 || /\s/.test(wikilinks[hit.start - 1]));
  let result = wikilinks;
  for (const hit of mentions.reverse()) {
    result = result.slice(0, hit.start) + ` ${hit.key} ` + result.slice(hit.end);
  }
  return result;
}

export interface ResolvedChatFileMentions {
  displayContent: string;
  llmContent: string;
}

export async function resolveChatFileMentions(
  app: App,
  content: string,
  sources: CommandVariableSources,
  options: Pick<MessageVariableOptions, "inlineFileMentions" | "readMentionText">
    & Partial<Pick<MessageVariableOptions, "vaultToolAllowedFolders" | "maxNoteChars">>,
): Promise<ResolvedChatFileMentions> {
  // Resolve selections once: external selections are consumed by this call.
  const displayContent = await resolveCommandVariables(app, content, sources);
  let modelContent = normalizeFileMentions(app, displayContent);
  if (!options.inlineFileMentions) {
    const files = app.vault.getFiles().filter(file =>
      /^(md|pdf)$/i.test(file.extension)
      && isFileAllowedForVaultTools(file, options.vaultToolAllowedFolders),
    );
    const byPath = new Map(files.map(file => [file.path, file]));
    const occurrences = findFileMentionOccurrences(modelContent, [...byPath.keys()], {
      requireWhitespaceBoundary: true,
    });
    // Each reference carries its own metadata, so spaced paths and multiple files
    // stay unambiguous. Size comes from the vault index; no file body is opened.
    for (const hit of occurrences.reverse()) {
      const file = byPath.get(hit.key)!;
      const reference = `[[${file.path}]] (type: ${file.extension.toLowerCase()}; size: ${file.stat.size} bytes)`;
      modelContent = modelContent.slice(0, hit.start) + reference + modelContent.slice(hit.end);
    }
  }
  const llmContent = await resolveFileMentionContent(app, modelContent, {
    ...options,
    maxNoteChars: options.maxNoteChars ?? 0,
  });
  return { displayContent, llmContent };
}
