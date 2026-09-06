import type { Attachment } from "../core/message.js";
import type { FileExplorerData, RegenerateInfo } from "./types.js";

/**
 * What a command node re-sends when the user asks for a revision: the prompt
 * that produced the output, the output itself, and what they want changed.
 */
export function buildRegenerationPrompt(info: RegenerateInfo): string {
  return `${info.originalPrompt}

[Previous output]
${info.previousOutput}

[User feedback]
${info.additionalRequest}

Please revise the output based on the user's feedback above.`;
}

/** A comma-separated node property, as the list of names it means. */
export function parseNodeList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

/**
 * Whether a parsed variable really is a file. A workflow variable holds
 * whatever an earlier node put there, so the shape is checked rather than
 * asserted: reading `mimeType` off something else throws.
 */
export function isFileExplorerData(value: unknown): value is FileExplorerData {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<FileExplorerData>;
  return typeof candidate.basename === "string"
    && typeof candidate.mimeType === "string"
    && typeof candidate.contentType === "string"
    && typeof candidate.data === "string";
}

/**
 * The kind a vault file's own MIME type makes it. Unlike the composer's picker,
 * which offers an explicit list of types, this trusts what the vault reports
 * and only has to place it — anything it cannot place travels as text.
 */
export function attachmentKindForMimeType(mimeType: string): Attachment["type"] {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "text";
}

/**
 * The attachments a node's `attachments` property names. Only binary files
 * become attachments; a text file is already in the prompt through variable
 * substitution. A variable that is missing, is not JSON, or is not a file is
 * skipped rather than failing the node.
 */
export function attachmentsFromVariables(
  attachmentsProperty: string | undefined,
  variables: Map<string, string | number>,
): Attachment[] {
  const attachments: Attachment[] = [];
  for (const name of parseNodeList(attachmentsProperty)) {
    const value = variables.get(name);
    if (typeof value !== "string" || !value) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      continue;
    }
    if (!isFileExplorerData(parsed) || parsed.contentType !== "binary" || !parsed.data) continue;
    attachments.push({
      name: parsed.basename,
      type: attachmentKindForMimeType(parsed.mimeType),
      mimeType: parsed.mimeType,
      data: parsed.data,
    });
  }
  return attachments;
}
