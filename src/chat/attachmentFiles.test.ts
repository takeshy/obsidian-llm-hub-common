import { describe, expect, it, vi } from "vitest";
import {
  ALL_ATTACHMENT_KINDS,
  acceptedAttachmentTypes,
  attachmentKindFor,
  fileToAttachment,
  isAttachmentRejection,
} from "./attachmentFiles.js";

/** A stand-in for the File a picker hands over; only these fields are read. */
function file(name: string, type: string, size = 10): File {
  return { name, type, size } as File;
}

class FakeFileReader {
  result = "data:application/octet-stream;base64,QUJD";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL() { queueMicrotask(() => this.onload?.()); }
}
vi.stubGlobal("FileReader", FakeFileReader);

describe("attachmentKindFor", () => {
  it("recognises each kind by MIME type", () => {
    expect(attachmentKindFor(file("a.png", "image/png"))).toBe("image");
    expect(attachmentKindFor(file("a.pdf", "application/pdf"))).toBe("pdf");
    expect(attachmentKindFor(file("a.mp3", "audio/mpeg"))).toBe("audio");
    expect(attachmentKindFor(file("a.mp4", "video/mp4"))).toBe("video");
  });

  it("accepts a markdown or text file that reports no MIME type", () => {
    expect(attachmentKindFor(file("notes.md", ""))).toBe("text");
    expect(attachmentKindFor(file("notes.txt", ""))).toBe("text");
  });

  it("refuses a kind the host does not offer", () => {
    // Local models take no audio, so the picker must not accept one either.
    expect(attachmentKindFor(file("a.mp3", "audio/mpeg"), ["image", "pdf", "text"])).toBeNull();
    expect(attachmentKindFor(file("a.zip", "application/zip"))).toBeNull();
  });
});

describe("acceptedAttachmentTypes", () => {
  it("lists the MIME types the host offers", () => {
    expect(acceptedAttachmentTypes(["image"])).toBe("image/png,image/jpeg,image/gif,image/webp");
    expect(acceptedAttachmentTypes(["pdf"])).not.toContain("audio");
  });

  it("adds the text extensions, since those files often have no MIME type", () => {
    expect(acceptedAttachmentTypes(["text"]).split(",")).toContain(".md");
    expect(acceptedAttachmentTypes(["image"]).split(",")).not.toContain(".md");
  });

  it("offers everything by default", () => {
    const all = acceptedAttachmentTypes();
    for (const kind of ALL_ATTACHMENT_KINDS) expect(all.length).toBeGreaterThan(0);
    expect(all).toContain("video/mp4");
  });
});

describe("fileToAttachment", () => {
  it("reads a supported file into base64 without the data URL prefix", async () => {
    const result = await fileToAttachment(file("a.png", "image/png"));
    expect(result).toEqual({ name: "a.png", type: "image", mimeType: "image/png", data: "QUJD" });
  });

  it("gives a text file a MIME type even when the picker reported none", async () => {
    const result = await fileToAttachment(file("notes.md", ""));
    expect(result).toMatchObject({ type: "text", mimeType: "text/plain" });
  });

  it("says which of the two reasons it refused, so the caller can explain", async () => {
    const tooLarge = await fileToAttachment(file("big.png", "image/png", 21 * 1024 * 1024));
    expect(isAttachmentRejection(tooLarge) && tooLarge.reason).toBe("too-large");

    const unsupported = await fileToAttachment(file("a.zip", "application/zip"));
    expect(isAttachmentRejection(unsupported) && unsupported.reason).toBe("unsupported-type");
  });
});
