import { describe, expect, it } from "vitest";
import { parseThinkTags } from "./thinkTagParser.js";

/** Feed a stream one piece at a time, the way a provider does. */
function stream(pieces: string[]) {
  let inThinkTag = false;
  let tagBuffer = "";
  const text: string[] = [];
  const thinking: string[] = [];
  for (const piece of pieces) {
    const parsed = parseThinkTags(piece, inThinkTag, tagBuffer);
    inThinkTag = parsed.inThinkTag;
    tagBuffer = parsed.tagBuffer;
    for (const item of parsed.items) {
      (item.type === "thinking" ? thinking : text).push(item.content ?? "");
    }
  }
  return { text: text.join(""), thinking: thinking.join(""), tagBuffer, inThinkTag };
}

describe("parseThinkTags", () => {
  it("keeps content without tags as plain text", () => {
    expect(stream(["Hello ", "world"])).toMatchObject({ text: "Hello world", thinking: "" });
  });

  it("routes what is between the tags to thinking", () => {
    expect(stream(["<think>hmm</think>Answer."]))
      .toMatchObject({ text: "Answer.", thinking: "hmm" });
  });

  it("holds back a tag split across chunks instead of showing it", () => {
    // The whole point of the buffer: "<thi" must not reach the user as text.
    const mid = parseThinkTags("Wait <thi", false, "");
    expect(mid.items.map(i => i.content).join("")).toBe("Wait ");
    expect(mid.tagBuffer).toBe("<thi");

    expect(stream(["Wait <thi", "nk>why</th", "ink>Done."]))
      .toMatchObject({ text: "Wait Done.", thinking: "why" });
  });

  it("stays in the reasoning channel while the tag is still open", () => {
    const parsed = stream(["<think>still ", "going"]);
    expect(parsed).toMatchObject({ thinking: "still going", text: "", inThinkTag: true });
  });

  it("handles several tag pairs in one stream", () => {
    expect(stream(["a<think>x</think>b<think>y</think>c"]))
      .toMatchObject({ text: "abc", thinking: "xy" });
  });

  it("does not mistake a lookalike for the opening tag", () => {
    expect(stream(["<thinking>not a tag"]))
      .toMatchObject({ text: "<thinking>not a tag", thinking: "" });
  });
});
