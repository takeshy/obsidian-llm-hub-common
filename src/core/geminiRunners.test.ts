import { afterEach, describe, expect, it, vi } from "vitest";
import { runGeminiInteractions } from "./geminiInteractionsRunner.js";
import { runGeminiGenerateContentTools, type GeminiGenerationResponse } from "./geminiGenerationRunner.js";
import { GeminiToolBudget } from "./geminiToolExecution.js";
import { tracing } from "./tracingHooks.js";
import type { StreamChunk } from "./provider.js";

async function* stream<T>(events: T[]) { yield* events; }
async function collect(generator: AsyncIterable<StreamChunk>) {
  const chunks: StreamChunk[] = [];
  for await (const chunk of generator) chunks.push(chunk);
  return chunks;
}
const base = { model: "gemini-3.8-flash", traceId: null, generationId: null, maxFunctionCalls: 3,
  warningThreshold: 1, limitPolicy: { kind: "fixed" as const } };
const attachment = { name: "note.pdf", type: "pdf" as const, mimeType: "application/pdf", data: "YWJj" };
const call = (id: string) => [
  { event_type: "step.start", index: Number(id), step: { type: "function_call", id, name: "read", arguments: { path: id } } },
  { event_type: "step.stop", index: Number(id) },
];
const complete = { event_type: "interaction.completed", interaction: { status: "completed" } };
const interactionBase = { ...base, input: "hello", ragAlreadyEmitted: false, searchPolicy: "native" as const };
afterEach(() => vi.restoreAllMocks());

describe("shared Gemini tool budget", () => {
  it("keeps fixed warnings based on the post-round remaining budget", async () => {
    const budget = new GeminiToolBudget(3, 1, { kind: "fixed" });
    expect(await budget.plan([1, 2])).toMatchObject({ callsToExecute: [1, 2], remainingAfter: 1, warning: expect.stringContaining("1 function calls remaining") });
    expect((await budget.plan([1, 2])).warning).toBeUndefined();
  });
  it("extends before planning calls and never runs approval for a fixed limit", async () => {
    const approve = vi.fn().mockResolvedValue(2);
    const budget = new GeminiToolBudget(1, 1, { kind: "extendable", options: { requestLimitExtension: approve }, defaultExtensionAmount: 2 });
    expect(await budget.plan([1, 2, 3, 4])).toMatchObject({ callsToExecute: [1, 2, 3], skippedCount: 1, warning: expect.stringContaining("3 function calls remaining") });
    expect(approve).toHaveBeenCalledWith({ used: 0, currentLimit: 1, extensionAmount: 2, pendingCalls: 4, remaining: 1 });
  });
});

describe("Interactions runner", () => {
  it("chains rounds, executes in order, strips result media and sends all results before deduplicated attachments", async () => {
    const create = vi.fn()
      .mockResolvedValueOnce(stream([{ event_type: "interaction.created", interaction: { id: "first" } }, ...call("1"), ...call("2"), complete]))
      .mockResolvedValueOnce(stream([{ event_type: "interaction.created", interaction: { id: "second" } }, { event_type: "step.delta", delta: { type: "text", text: "answer" } }, complete]));
    const execute = vi.fn().mockResolvedValue({ found: true, attachments: [attachment, attachment] });
    const chunks = await collect(runGeminiInteractions({ ...interactionBase, previousInteractionId: "previous", create, executeToolCall: execute }));
    expect(execute.mock.calls).toEqual([["read", { path: "1" }], ["read", { path: "2" }]]);
    expect(create.mock.calls[0][0]).toMatchObject({ previousInteractionId: "previous", includeTools: true });
    const next = create.mock.calls[1][0];
    expect(next.previousInteractionId).toBe("first");
    expect(next.input.map((step: { type: string }) => step.type)).toEqual(["function_result", "function_result", "user_input", "user_input"]);
    expect(next.input[0]).toMatchObject({ call_id: "1", result: '{"found":true}' });
    expect(next.input[2].content).toHaveLength(1);
    expect(chunks.filter(chunk => chunk.type === "tool_result").map(chunk => chunk.toolResult?.result)).toEqual([{ found: true }, { found: true }]);
    expect(chunks.at(-1)).toMatchObject({ type: "done", interactionId: "second" });
  });
  it("limits execution and consumes only one final round, including its usage and errors", async () => {
    const create = vi.fn()
      .mockResolvedValueOnce(stream([...call("1"), ...call("2"), complete]))
      .mockResolvedValueOnce(stream([{ event_type: "interaction.completed", interaction: { status: "failed", usage: { total_tokens: 9 } } }]));
    const execute = vi.fn().mockResolvedValue({ ok: true });
    const end = vi.spyOn(tracing, "generationEnd");
    const chunks = await collect(runGeminiInteractions({ ...interactionBase, maxFunctionCalls: 1, create, executeToolCall: execute }));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(2);
    expect(chunks.at(-1)).toMatchObject({ type: "error" });
    expect(chunks.some(chunk => chunk.type === "done")).toBe(false);
    expect(end).toHaveBeenLastCalledWith(null, expect.objectContaining({ usage: expect.objectContaining({ total: 9 }) }));
  });
  it("zero budget requests a final answer without tools", async () => {
    const create = vi.fn().mockResolvedValueOnce(stream(call("1"))).mockResolvedValueOnce(stream([complete]));
    const execute = vi.fn();
    await collect(runGeminiInteractions({ ...interactionBase, maxFunctionCalls: 0, create, executeToolCall: execute }));
    expect(execute).not.toHaveBeenCalled();
    expect(create.mock.calls[1][0]).toMatchObject({ includeTools: false, input: expect.any(String) });
  });
  it("closes the iterator immediately on API error while retaining prior usage", async () => {
    const nextAfterError = vi.fn();
    const close = vi.fn();
    const end = vi.spyOn(tracing, "generationEnd");
    async function* failingStream() {
      try {
        yield { event_type: "interaction.status_update", metadata: { total_usage: { total_tokens: 7 } } };
        yield { event_type: "error", error: { message: "API failed" } };
        nextAfterError();
        yield { event_type: "step.delta", delta: { type: "text", text: "must not be read" } };
      } finally { close(); }
    }
    const chunks = await collect(runGeminiInteractions({ ...interactionBase, create: async () => failingStream() }));
    expect(chunks).toEqual([{ type: "error", error: "API failed" }]);
    expect(nextAfterError).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(end).toHaveBeenLastCalledWith(null, expect.objectContaining({ usage: expect.objectContaining({ total: 7 }) }));
  });
  it("closes tool and generation traces when execution rejects", async () => {
    const spans = vi.spyOn(tracing, "spanEnd");
    const end = vi.spyOn(tracing, "generationEnd");
    const chunks = await collect(runGeminiInteractions({ ...interactionBase,
      create: async () => stream(call("1")), executeToolCall: async () => { throw new Error("tool failed"); },
    }));
    expect(chunks.at(-1)).toEqual({ type: "error", error: "tool failed" });
    expect(spans).toHaveBeenCalledWith(null, { error: "tool failed" });
    expect(end).toHaveBeenCalledWith(null, expect.objectContaining({ metadata: { toolCallCount: 1, roundCount: 1 } }));
  });
  it.each(["native", "pre-retrieved"] as const)("respects %s search policy while collecting web sources across rounds", async searchPolicy => {
    const create = vi.fn().mockResolvedValueOnce(stream([
      { event_type: "step.start", step: { type: "file_search_call" } },
      { event_type: "step.delta", delta: { type: "file_search_result", result: [{ title: "note", text: "context" }] } },
      { event_type: "step.delta", delta: { type: "google_search_result", result: [{ url: "https://a.test" }] } }, ...call("1"),
    ])).mockResolvedValueOnce(stream([{ event_type: "step.delta", delta: { type: "google_search_result", result: [{ url: "https://a.test" }, { url: "https://b.test" }] } }, complete]));
    const chunks = await collect(runGeminiInteractions({ ...interactionBase, searchPolicy, create, executeToolCall: async () => ({}) }));
    expect(chunks.filter(chunk => chunk.type === "rag_used")).toHaveLength(searchPolicy === "native" ? 1 : 0);
    expect(chunks.at(-1)?.webSearchSources).toHaveLength(2);
  });
  it("rejects empty final streams instead of emitting done", async () => {
    const create = vi.fn().mockResolvedValueOnce(stream(call("1"))).mockResolvedValueOnce(stream([]));
    const chunks = await collect(runGeminiInteractions({ ...interactionBase, create, maxFunctionCalls: 1, executeToolCall: async () => ({}) }));
    expect(chunks.at(-1)?.type).toBe("error");
  });
});

describe("GenerateContent tool runner", () => {
  const fc = { functionCall: { id: "1", name: "read", args: {} }, thoughtSignature: "preserve-me" };
  const response = (parts: object[]): GeminiGenerationResponse => ({ candidates: [{ content: { parts } }] });
  it("preserves signed model parts and sends function responses before media", async () => {
    const create = vi.fn().mockResolvedValueOnce(stream([response([fc])])).mockResolvedValueOnce(stream([response([{ text: "answer" }])]));
    const chunks = await collect(runGeminiGenerateContentTools({ ...base, contents: [{ role: "user", parts: [{ text: "question" }] }], create,
      executeToolCall: async () => ({ ok: true, attachments: [attachment, attachment] }),
    }));
    const contents = create.mock.calls[1][0];
    expect(contents[1].parts[0]).toBe(fc);
    expect(contents[2].parts).toEqual([
      { functionResponse: { id: "1", name: "read", response: { output: '{"ok":true}' } } },
      { inlineData: { mimeType: "application/pdf", data: "YWJj" } },
    ]);
    expect(chunks.at(-1)?.type).toBe("done");
  });
  it("bounds rounds even when the model keeps requesting tools after exhaustion", async () => {
    const create = vi.fn().mockImplementation(async () => stream([response([fc])]));
    const execute = vi.fn().mockResolvedValue({});
    await collect(runGeminiGenerateContentTools({ ...base, contents: [], maxFunctionCalls: 1, create, executeToolCall: execute }));
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][1]).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("accounts for search reported after usage, without duplicating the search event", async () => {
    const create = async () => stream([
      { usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } },
      response([{ toolResponse: { toolType: "GOOGLE_SEARCH_WEB", response: { url: "https://a.test" } } }]),
      response([{ toolResponse: { toolType: "GOOGLE_SEARCH_WEB", response: { url: "https://a.test" } } }]),
    ]);
    const chunks = await collect(runGeminiGenerateContentTools({ ...base, contents: [], create }));
    expect(chunks.filter(chunk => chunk.type === "web_search_used")).toHaveLength(1);
    expect(chunks.at(-1)?.usage?.totalCost).toBeGreaterThan(0.014);
    expect(chunks.at(-1)?.webSearchSources).toHaveLength(1);
  });
  it.each([[], [{ candidates: [{ finishReason: "SAFETY" }] }]])("reports empty or blocked streams", async events => {
    const chunks = await collect(runGeminiGenerateContentTools({ ...base, contents: [], create: async () => stream(events) }));
    expect(chunks.at(-1)?.type).toBe("error");
    expect(chunks.some(chunk => chunk.type === "done")).toBe(false);
  });
});
