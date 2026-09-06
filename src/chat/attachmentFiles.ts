import type { Attachment } from "../core/message.js";

/** What a host can hand to its models. Not every provider takes audio or video. */
export type AttachmentKind = "image" | "pdf" | "text" | "audio" | "video";

export const ATTACHMENT_MIME_TYPES: Record<AttachmentKind, readonly string[]> = {
  image: ["image/png", "image/jpeg", "image/gif", "image/webp"],
  pdf: ["application/pdf"],
  text: ["text/plain", "text/markdown", "text/csv", "application/json"],
  audio: ["audio/mpeg", "audio/wav", "audio/flac", "audio/aac", "audio/mp4", "audio/opus", "audio/ogg"],
  video: ["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo", "video/x-matroska"],
};

/** Everything a host with no provider restriction can attach. */
export const ALL_ATTACHMENT_KINDS: readonly AttachmentKind[] = ["image", "pdf", "text", "audio", "video"];

export const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;

/**
 * The `accept` list for a file input offering these kinds. The extensions are
 * there because a Markdown or plain-text file often arrives with an empty or
 * unhelpful MIME type.
 */
export function acceptedAttachmentTypes(kinds: readonly AttachmentKind[] = ALL_ATTACHMENT_KINDS): string {
  const types = kinds.flatMap((kind) => [...ATTACHMENT_MIME_TYPES[kind]]);
  if (kinds.includes("text")) types.push(".md", ".txt");
  return types.join(",");
}

/** The kind a file belongs to, or null when the host does not offer it. */
export function attachmentKindFor(
  file: { name: string; type: string },
  kinds: readonly AttachmentKind[] = ALL_ATTACHMENT_KINDS,
): AttachmentKind | null {
  for (const kind of kinds) {
    if (ATTACHMENT_MIME_TYPES[kind].includes(file.type)) return kind;
    // A .md or .txt file frequently reports no MIME type at all.
    if (kind === "text" && (file.name.endsWith(".md") || file.name.endsWith(".txt"))) return "text";
  }
  return null;
}

export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // Drop the "data:<mime>;base64," prefix the reader adds.
      resolve(String(reader.result).split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export interface AttachmentRejection {
  reason: "too-large" | "unsupported-type";
  file: File;
}

/**
 * Read a picked file into an Attachment. Returns the reason instead when the
 * file is too large or of a kind this host does not offer, so the caller can
 * tell the user which of the two happened.
 */
export async function fileToAttachment(
  file: File,
  kinds: readonly AttachmentKind[] = ALL_ATTACHMENT_KINDS,
  maxSize = MAX_ATTACHMENT_SIZE,
): Promise<Attachment | AttachmentRejection> {
  if (file.size > maxSize) return { reason: "too-large", file };
  const kind = attachmentKindFor(file, kinds);
  if (!kind) return { reason: "unsupported-type", file };
  return {
    name: file.name,
    type: kind,
    // A text file with no MIME type still has to declare one to a provider.
    mimeType: kind === "text" ? file.type || "text/plain" : file.type,
    data: await fileToBase64(file),
  };
}

export function isAttachmentRejection(
  result: Attachment | AttachmentRejection,
): result is AttachmentRejection {
  return "reason" in result;
}
