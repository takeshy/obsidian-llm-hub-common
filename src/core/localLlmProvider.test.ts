import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { buildLocalLlmRequest, buildOllamaMessages, runLocalLlmChat } from "./localLlmProvider.js";
import { LocalLlmResponseParser } from "./localLlmResponse.js";
import { streamLocalLlmLines } from "./localLlmTransport.js";
import type { NodeHttpModule, NodeIncomingMessage } from "./localLlmStream.js";
import type { StreamChunk } from "./provider.js";

const config = { framework: "lm-studio", baseUrl: "http://localhost:1234", model: "local", temperature: 0, maxTokens: 32 };
const messages = [{ role: "user" as const, content: "日本語", timestamp: 0 }];
const tools = [{ type: "function" as const, function: { name: "read", description: "read", parameters: { type: "object" as const, properties: {} } } }];
const sse = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
async function collect<T>(stream: AsyncIterable<T>) { const values: T[] = []; for await (const value of stream) values.push(value); return values; }
function mockHttp(send: (response: EventEmitter, request: EventEmitter) => void, statusCode = 200) {
  const response = Object.assign(new EventEmitter(), { statusCode, statusMessage: "status" });
  let callback: (response: NodeIncomingMessage) => void;
  const request = Object.assign(new EventEmitter(), {
    write: vi.fn(), end: vi.fn(() => queueMicrotask(() => { callback(response); send(response, request); })), destroy: vi.fn(),
  });
  const http: NodeHttpModule = { request: vi.fn((_options, cb) => { callback = cb; return request; }) };
  return { http, request, response };
}
const bytes = (text: string) => new TextEncoder().encode(text);

describe("local LLM request union", () => {
  it("preserves vision, assistant reasoning and completed tools for both protocols", () => {
    const history = [...messages.map(message => ({ ...message, attachments: [{ name: "image", type: "image" as const, mimeType: "image/png", data: "abc" }] })),
      { role: "assistant" as const, content: "", thinking: "thought", timestamp: 1,
        toolCalls: [{ id: "c", name: "read", args: { path: "note" } }], toolResults: [{ toolCallId: "c", result: { ok: true } }] },
    ];
    const native = buildOllamaMessages(history, "system");
    expect(native[1].images).toEqual(["abc"]);
    expect(native[2]).toMatchObject({ thinking: "thought", tool_calls: [{ function: { name: "read", arguments: { path: "note" } } }] });
    expect(native[3]).toMatchObject({ role: "tool", tool_name: "read" });
    const request = buildLocalLlmRequest({ config, messages: history, systemPrompt: "system", tools });
    expect(JSON.parse(request.body).messages[1].content[1]).toMatchObject({ type: "image_url" });
  });
  it("shares endpoint rules, native options and authenticated headers", () => {
    const request = buildLocalLlmRequest({ config: { ...config, framework: "ollama", baseUrl: "http://localhost:5432/", apiKey: "key" }, messages, systemPrompt: "system", tools });
    expect(request.url.href).toBe("http://localhost:5432/api/chat");
    expect(request.headers.Authorization).toBe("Bearer key");
    expect(JSON.parse(request.body)).toMatchObject({ options: { temperature: 0, num_predict: 32 }, tools });
    expect(JSON.parse(buildLocalLlmRequest({ config: { ...config, framework: "anythingllm" }, messages, systemPrompt: "", tools }).body).tools).toBeUndefined();
  });
});

describe("local response accumulation", () => {
  it("keeps split thinking tags and emits native reasoning aliases as thinking", () => {
    const parser = new LocalLlmResponseParser("openai");
    const parts = ["<thi", "nk>reason</thi", "nk>answer"].flatMap(content => parser.push(sse({ choices: [{ delta: { content } }] })));
    expect(parts.filter(chunk => chunk.type === "thinking").map(chunk => chunk.content).join("")).toBe("reason");
    expect(parts.filter(chunk => chunk.type === "text").map(chunk => chunk.content).join("")).toBe("answer");
    const native = new LocalLlmResponseParser("openai");
    expect(native.push(sse({ choices: [{ delta: { reasoning: "thought", content: "<think>literal" } }] }))).toEqual([
      { type: "thinking", content: "thought" }, { type: "text", content: "<think>literal" },
    ]);
  });
  it("assembles interleaved tool calls before terminal usage even without finish_reason", () => {
    const parser = new LocalLlmResponseParser("openai", () => "fallback");
    parser.push(sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "a", function: { name: "read", arguments: '{"path":' } }, { index: 1, id: "b", function: { name: "find", arguments: "broken" } }] } }] }));
    parser.push(sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"note"}' } }] } }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } }));
    expect(parser.push("data:[DONE]")).toEqual([
      { type: "tool_call", toolCall: { id: "a", name: "read", args: { path: "note" } } },
      { type: "tool_call", toolCall: { id: "b", name: "find", args: {} } },
      { type: "done", usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } },
    ]);
    expect(parser.finish()).toEqual([]);
  });
  it("reports missing tool deltas and does not duplicate tools at DONE", () => {
    const parser = new LocalLlmResponseParser("openai");
    expect(parser.push(sse({ choices: [{ finish_reason: "tool_calls" }] }))).toEqual([{ type: "incomplete_tool_call" }]);
    parser.push(sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "a", function: { name: "read", arguments: "{}" } }] } }] }));
    expect(parser.push(sse({ choices: [{ finish_reason: "tool_calls" }] }))).toHaveLength(1);
    expect(parser.push("data: [DONE]")).toEqual([{ type: "done", usage: undefined }]);
  });
  it.each(["ollama", "openai"] as const)("surfaces %s in-band errors without success", format => {
    const parser = new LocalLlmResponseParser(format);
    const value = { error: "out of context" };
    expect(parser.push(format === "ollama" ? JSON.stringify(value) : sse(value))).toEqual([{ type: "error", error: "out of context" }]);
    expect(parser.finish()).toEqual([]);
  });
  it("parses native Ollama tools and flushes tag fragments with usage", () => {
    const parser = new LocalLlmResponseParser("ollama", () => "id");
    expect(parser.push(JSON.stringify({ message: { tool_calls: [{ function: { name: "read", arguments: { path: "note" } } }], content: "last<" }, done: true, prompt_eval_count: 1, eval_count: 2 }))).toEqual([
      { type: "tool_call", toolCall: { id: "id", name: "read", args: { path: "note" } } },
      { type: "text", content: "last" }, { type: "text", content: "<" },
      { type: "done", usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } },
    ]);
  });
});

describe("local HTTP stream lifecycle", () => {
  it("decodes split UTF-8 and final lines without newline, sets byte length and closes the request", async () => {
    const wire = bytes(sse({ choices: [{ delta: { content: "日本語" } }] }) + "data: [DONE]");
    const mock = mockHttp(response => { for (const byte of wire) response.emit("data", Uint8Array.of(byte)); response.emit("end"); });
    const chunks = await collect(runLocalLlmChat({ config, messages, systemPrompt: "", http: mock.http }));
    expect(chunks.filter(chunk => chunk.type === "text")).toEqual([{ type: "text", content: "日本語" }]);
    const options = vi.mocked(mock.http.request).mock.calls[0][0];
    expect(options.headers["Content-Length"]).toBe(String(bytes(mock.request.write.mock.calls[0][0]).length));
    expect(mock.request.destroy).toHaveBeenCalledOnce();
  });
  it("does not lose request errors that mark the stream done before waiting", async () => {
    const mock = mockHttp((_response, request) => request.emit("error", new Error("refused")));
    expect(await collect(runLocalLlmChat({ config, messages, systemPrompt: "", http: mock.http }))).toEqual([{ type: "error", error: "Connection failed: refused" }]);
  });
  it("bounds HTTP error output and listens for response errors", async () => {
    const mock = mockHttp(response => { response.emit("data", bytes("bad".repeat(100))); response.emit("end"); }, 500);
    const chunks = await collect(runLocalLlmChat({ config, messages, systemPrompt: "", http: mock.http }));
    expect(chunks[0]).toEqual({ type: "error", error: `HTTP 500: ${"bad".repeat(100).slice(0, 200)}` });
    const failed = mockHttp(response => response.emit("error", new Error("broken response")), 500);
    expect((await collect(runLocalLlmChat({ config, messages, systemPrompt: "", http: failed.http })))[0].error).toContain("broken response");
  });
  it("aborts before connection or while waiting and never emits done", async () => {
    const controller = new AbortController(); controller.abort();
    const mock = mockHttp(() => {});
    expect(await collect(runLocalLlmChat({ config, messages, systemPrompt: "", http: mock.http, signal: controller.signal }))).toEqual([]);
    expect(mock.http.request).not.toHaveBeenCalled();
    const active = new AbortController();
    const waiting = mockHttp(() => active.abort());
    expect(await collect(runLocalLlmChat({ config, messages, systemPrompt: "", http: waiting.http, signal: active.signal }))).toEqual([]);
    expect(waiting.request.destroy).toHaveBeenCalled();
  });
  it("times out idle streams and releases the request", async () => {
    const mock = mockHttp(() => {});
    const chunks = await collect(runLocalLlmChat({ config: { ...config, streamIdleTimeoutSeconds: 0.001 }, messages, systemPrompt: "", http: mock.http }));
    expect(chunks[0].error).toContain("Stream timed out");
    expect(mock.request.destroy).toHaveBeenCalled();
  });
  it("closes transport on early consumer return", async () => {
    const mock = mockHttp(response => response.emit("data", bytes("line\n")));
    const iterator = streamLocalLlmLines({ url: new URL(config.baseUrl), body: "{}", headers: {}, idleTimeoutMs: 100, http: mock.http });
    expect(await iterator.next()).toEqual({ value: "line", done: false });
    await iterator.return();
    expect(mock.request.destroy).toHaveBeenCalledOnce();
  });
  it("converts inline tool JSON after text and before done", async () => {
    const mock = mockHttp(response => {
      response.emit("data", bytes(sse({ choices: [{ delta: { content: '{"name":"read","arguments":{"path":"note"}}' } }] }) + "data: [DONE]\n")); response.emit("end");
    });
    const chunks: StreamChunk[] = await collect(runLocalLlmChat({ config, messages, systemPrompt: "", tools, http: mock.http }));
    expect(chunks.map(chunk => chunk.type)).toEqual(["text", "replace_text", "tool_call", "done"]);
    expect(chunks[2].toolCall).toMatchObject({ name: "read", args: { path: "note" } });
  });
});
