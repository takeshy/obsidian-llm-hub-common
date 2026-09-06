import { describe, expect, it } from "vitest";
import {
  attachmentKindForMimeType,
  attachmentsFromVariables,
  buildRegenerationPrompt,
  isFileExplorerData,
  parseNodeList,
} from "./commandNode.js";

const binary = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  path: "Files/a.png", basename: "a.png", name: "a.png", extension: "png",
  mimeType: "image/png", contentType: "binary", data: "QUJD", ...overrides,
});

describe("buildRegenerationPrompt", () => {
  it("carries the prompt, the output and the feedback", () => {
    const prompt = buildRegenerationPrompt({
      commandNodeId: "n1", originalPrompt: "Draft an intro", previousOutput: "Too long", additionalRequest: "Shorter",
    });
    expect(prompt.startsWith("Draft an intro")).toBe(true);
    expect(prompt).toContain("[Previous output]\nToo long");
    expect(prompt).toContain("[User feedback]\nShorter");
    expect(prompt.trimEnd().endsWith("Please revise the output based on the user's feedback above.")).toBe(true);
  });
});

describe("parseNodeList", () => {
  it("trims the names and drops the gaps", () => {
    expect(parseNodeList(" a , ,b ")).toEqual(["a", "b"]);
    expect(parseNodeList("")).toEqual([]);
    expect(parseNodeList(undefined)).toEqual([]);
  });
});

describe("isFileExplorerData", () => {
  it("requires every field the caller then reads", () => {
    expect(isFileExplorerData(JSON.parse(binary()))).toBe(true);
    // Casting instead of checking meant reading mimeType off this and throwing.
    expect(isFileExplorerData({ contentType: "binary", data: "QUJD" })).toBe(false);
    expect(isFileExplorerData(null)).toBe(false);
    expect(isFileExplorerData("a string")).toBe(false);
  });
});

describe("attachmentKindForMimeType", () => {
  it("places a vault file by what it reports", () => {
    expect(attachmentKindForMimeType("image/heic")).toBe("image");
    expect(attachmentKindForMimeType("application/pdf")).toBe("pdf");
    expect(attachmentKindForMimeType("audio/ogg")).toBe("audio");
    expect(attachmentKindForMimeType("video/webm")).toBe("video");
  });

  it("sends anything it cannot place as text", () => {
    expect(attachmentKindForMimeType("application/octet-stream")).toBe("text");
  });
});

describe("attachmentsFromVariables", () => {
  const variables = new Map<string, string | number>([
    ["pic", binary()],
    ["doc", binary({ basename: "spec.pdf", mimeType: "application/pdf" })],
    ["note", binary({ contentType: "text", data: "plain text" })],
    ["junk", "not json"],
    ["shaped-wrong", JSON.stringify({ contentType: "binary", data: "QUJD" })],
    ["empty", binary({ data: "" })],
  ]);

  it("takes the binary files the property names, in order", () => {
    expect(attachmentsFromVariables("pic, doc", variables)).toEqual([
      { name: "a.png", type: "image", mimeType: "image/png", data: "QUJD" },
      { name: "spec.pdf", type: "pdf", mimeType: "application/pdf", data: "QUJD" },
    ]);
  });

  it("leaves text files to the prompt, which already has them", () => {
    expect(attachmentsFromVariables("note", variables)).toEqual([]);
  });

  it("skips a variable it cannot read rather than failing the node", () => {
    expect(attachmentsFromVariables("junk, shaped-wrong, empty, missing", variables)).toEqual([]);
  });
});
