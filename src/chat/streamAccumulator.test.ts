import { describe, expect, it } from "vitest";
import type { StreamChunk } from "../core/provider.js";
import {
  accumulateStreamChunk,
  createStreamAccumulation,
  pendingStatusFields,
} from "./streamAccumulator.js";

function fold(chunks: StreamChunk[]) {
  const acc = createStreamAccumulation();
  for (const chunk of chunks) accumulateStreamChunk(acc, chunk);
  return acc;
}

describe("accumulateStreamChunk", () => {
  it("joins the text and the thinking separately", () => {
    const acc = fold([
      { type: "thinking", content: "let me " },
      { type: "text", content: "Hello" },
      { type: "thinking", content: "check" },
      { type: "text", content: ", world" },
    ]);
    expect(acc).toMatchObject({ text: "Hello, world", thinking: "let me check" });
  });

  it("keeps every tool call but names each tool once", () => {
    const acc = fold([
      { type: "tool_call", toolCall: { name: "read_note", args: { fileName: "a.md" } } },
      { type: "tool_result", toolResult: { name: "read_note", result: "a" } },
      { type: "tool_call", toolCall: { name: "read_note", args: { fileName: "b.md" } } },
      { type: "tool_call", toolCall: { name: "search_notes", args: {} } },
    ] as StreamChunk[]);
    expect(acc.toolsUsed).toEqual(["read_note", "search_notes"]);
    expect(acc.toolCalls).toHaveLength(3);
    expect(acc.toolResults).toHaveLength(1);
  });

  it("replaces the text a provider takes back", () => {
    // A local model can emit its tool call as inline JSON; the provider strips
    // it out after the fact, and appending the correction would show both.
    const acc = fold([
      { type: "text", content: 'Sure. {"tool":"read_note"}' },
      { type: "replace_text", content: "Sure." },
    ] as StreamChunk[]);
    expect(acc.text).toBe("Sure.");
  });

  it("reports a truncated tool call so the round can be retried", () => {
    expect(fold([{ type: "incomplete_tool_call" }])).toMatchObject({ incompleteToolCall: true });
    expect(createStreamAccumulation().incompleteToolCall).toBe(false);
  });

  it("records that a search ran even when it matched nothing", () => {
    expect(fold([{ type: "rag_used" }])).toMatchObject({ ragUsed: true, ragSources: [] });
    expect(fold([{ type: "web_search_used" }])).toMatchObject({ webSearchUsed: true });
  });

  it("takes the sources a search reports", () => {
    const acc = fold([{ type: "rag_used", ragSources: ["Notes/a.md"], ragContexts: [{ source: "Notes/a.md", text: "x" }] }] as StreamChunk[]);
    expect(acc.ragSources).toEqual(["Notes/a.md"]);
    expect(acc.ragContexts).toHaveLength(1);
  });

  it("keeps the sources of every search, not just the last one", () => {
    // Searching two indexes reports two chunks; replacing dropped the first
    // index's sources from the message.
    const acc = fold([
      { type: "rag_used", ragSources: ["a.md", "b.md"], ragContexts: [{ source: "a.md", text: "x" }] },
      { type: "rag_used", ragSources: ["b.md", "c.md"], ragContexts: [{ source: "a.md", text: "x" }, { source: "c.md", text: "y" }] },
    ] as StreamChunk[]);
    expect(acc.ragSources).toEqual(["a.md", "b.md", "c.md"]);
    expect(acc.ragContexts).toEqual([{ source: "a.md", text: "x" }, { source: "c.md", text: "y" }]);
  });

  it("collects generated images and notes that generation happened", () => {
    const acc = fold([
      { type: "image_generated", generatedImage: { mimeType: "image/png", data: "AAA" } },
      { type: "image_generated" },
    ] as StreamChunk[]);
    expect(acc).toMatchObject({ imageGenerationUsed: true });
    expect(acc.generatedImages).toHaveLength(1);
  });

  it("takes the totals only the final chunk carries", () => {
    const acc = fold([
      { type: "text", content: "hi" },
      { type: "done", usage: { totalTokens: 12 }, interactionId: "int_1", webSearchSources: [{ title: "T", url: "https://e.test" }] },
    ] as StreamChunk[]);
    expect(acc.usage).toEqual({ totalTokens: 12 });
    expect(acc.interactionId).toBe("int_1");
    expect(acc.webSearchSources).toEqual([{ title: "T", url: "https://e.test" }]);
  });

  it("keeps a CLI session id so the conversation can be resumed", () => {
    expect(fold([{ type: "session_id", sessionId: "sess_1" }])).toMatchObject({ sessionId: "sess_1" });
  });

  it("throws on an error chunk, which is how a stream reports a failed turn", () => {
    const acc = createStreamAccumulation();
    expect(() => accumulateStreamChunk(acc, { type: "error", error: "quota exceeded" }))
      .toThrow("quota exceeded");
    expect(() => accumulateStreamChunk(acc, { type: "error" })).toThrow("Unknown error");
  });
});

describe("pendingStatusFields", () => {
  const edit = (path: string) => ({ originalPath: path, status: "applied" as const });

  it("reports the last change and all of them together", () => {
    // Setting only the singular reduced a turn that changed five files to one
    // badge, since the bubble prefers the plural and falls back to the singular.
    const fields = pendingStatusFields({
      edits: [edit("a.md"), edit("b.md")],
      deletes: [{ path: "c.md", status: "deleted" }],
      renames: [],
    });
    expect(fields.pendingEdit).toEqual(edit("b.md"));
    expect(fields.pendingEdits).toHaveLength(2);
    expect(fields.pendingDelete).toEqual({ path: "c.md", status: "deleted" });
    expect(fields.pendingDeletes).toHaveLength(1);
  });

  it("leaves out a kind of change that did not happen", () => {
    const fields = pendingStatusFields({ edits: [], deletes: [], renames: [] });
    expect(fields).toEqual({
      pendingEdit: undefined, pendingEdits: undefined,
      pendingDelete: undefined, pendingDeletes: undefined,
      pendingRename: undefined, pendingRenames: undefined,
    });
  });
});
