import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiGenerationClient, type GeminiGenerationSdk } from "./geminiGenerationClient.js";
import { tracing } from "./tracingHooks.js";
import type { Message } from "./message.js";
async function* stream<T>(values: T[]) { yield* values; }
async function collect<T>(values: AsyncIterable<T>) { const result: T[] = []; for await (const value of values) result.push(value); return result; }
function sdk(thinking = true) {
  return {
    generate: vi.fn<GeminiGenerationSdk["generate"]>().mockResolvedValue({ text: "answer" }),
    stream: vi.fn<GeminiGenerationSdk["stream"]>().mockImplementation(async () => stream([{ text: "answer" }])),
    chat: vi.fn<GeminiGenerationSdk["chat"]>().mockReturnValue({ sendMessageStream: vi.fn().mockImplementation(async () => stream([{ text: "workflow" }])) }),
    createResearch: vi.fn<GeminiGenerationSdk["createResearch"]>().mockResolvedValue({ id: "research" }),
    getResearch: vi.fn<GeminiGenerationSdk["getResearch"]>().mockResolvedValueOnce({ status: "in_progress" }).mockResolvedValue({ status: "completed", output_text: "report" }),
    delay: vi.fn<GeminiGenerationSdk["delay"]>().mockResolvedValue(undefined),
    safetySettings: [{ category: "test", threshold: "test" }], supportsThinking: vi.fn<GeminiGenerationSdk["supportsThinking"]>().mockReturnValue(thinking),
  } satisfies GeminiGenerationSdk;
}
const messages: Message[] = [{ role: "user", content: "question", timestamp: 0 }];
afterEach(() => vi.restoreAllMocks());

describe("shared Gemini generation client", () => {
  it("uses the current model and identical contents/config in chat and chatStream", async () => {
    const api = sdk();
    const client = new GeminiGenerationClient<string>("old", api);
    client.setModel("gemini-3.8-flash");
    expect(client.getModel()).toBe("gemini-3.8-flash");
    expect(await client.chat(messages, "instructions")).toBe("answer");
    expect(await collect(client.chatStream(messages, "instructions"))).toContainEqual({ type: "text", content: "answer" });
    expect(api.generate.mock.calls[0][0]).toEqual(api.stream.mock.calls[0][0]);
    expect(api.generate).toHaveBeenCalledWith({ model: "gemini-3.8-flash", contents: [{ role: "user", parts: [{ text: "question" }] }],
      config: { systemInstruction: "instructions", safetySettings: api.safetySettings } });
  });
  it.each([true, false])("uses actual workflow thinking capability %s for request and trace", async supported => {
    const api = sdk(supported);
    const start = vi.spyOn(tracing, "generationStart");
    const client = new GeminiGenerationClient("gemini-3.8-flash", api);
    await collect(client.generateWorkflowStream([
      ...messages, { role: "assistant", content: "answer", timestamp: 1 },
      { role: "user", content: "followup", timestamp: 2, attachments: [{ name: "image", type: "image", mimeType: "image/png", data: "abc" }] },
    ], "instructions", "trace"));
    expect(api.supportsThinking).toHaveBeenCalledWith("gemini-3.8-flash");
    expect(start).toHaveBeenCalledWith("trace", "generateWorkflowStream", expect.objectContaining({ metadata: { enableThinking: supported } }));
    const request = api.chat.mock.calls[0][0];
    expect(request.history).toHaveLength(2);
    expect(request.config.thinkingConfig).toEqual(supported ? { includeThoughts: true, thinkingLevel: "HIGH" } : undefined);
    expect(api.chat.mock.results[0].value.sendMessageStream).toHaveBeenCalledWith({ message: [
      { inlineData: { mimeType: "image/png", data: "abc" } }, { text: "followup" },
    ] });
  });
  it("records disabled workflow thinking when model config does not support it", async () => {
    const api = sdk(); const start = vi.spyOn(tracing, "generationStart");
    await collect(new GeminiGenerationClient("gemma-4-31b-it", api).generateWorkflowStream(messages));
    expect(api.chat.mock.calls[0][0].config.thinkingConfig).toBeUndefined();
    expect(start).toHaveBeenCalledWith(null, "generateWorkflowStream", expect.objectContaining({ metadata: { enableThinking: false } }));
  });
  it("rejects missing user turns and converts SDK chat creation errors to error chunks", async () => {
    const api = sdk(); const client = new GeminiGenerationClient<string>("model", api);
    for (const history of [[], [{ role: "assistant" as const, content: "answer", timestamp: 0 }]]) {
      expect(await collect(client.generateWorkflowStream(history))).toEqual([{ type: "error", error: "No user message to send" }]);
      expect(await collect(client.generateImageStream(history, "image-model"))).toEqual([{ type: "error", error: "No user message to send" }]);
    }
    expect(api.chat).not.toHaveBeenCalled();
    api.chat.mockImplementation(() => { throw new Error("SDK chat failed"); });
    expect(await collect(client.generateWorkflowStream(messages))).toEqual([{ type: "error", error: "SDK chat failed" }]);
  });
  it("wires research chaining and polling through the injected SDK and clock", async () => {
    const api = sdk(); const client = new GeminiGenerationClient<string>("model", api);
    expect(await collect(client.deepResearchStream("question", "previous"))).toContainEqual({ type: "text", content: "report" });
    expect(api.createResearch).toHaveBeenCalledWith(expect.objectContaining({ input: "question", previous_interaction_id: "previous", background: true, store: true }));
    expect(api.getResearch.mock.calls).toEqual([["research"], ["research"]]);
    expect(api.delay).toHaveBeenCalledWith(10000);
  });
  it.each([true, false])("constructs image modality requests with search %s", async search => {
    const api = sdk(); const client = new GeminiGenerationClient<string>("model", api);
    api.generate.mockResolvedValue({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "abc" } }] } }] });
    expect(await collect(client.generateImageStream(messages, "image-model", "instructions", search))).toContainEqual({ type: "image_generated", generatedImage: { mimeType: "image/png", data: "abc" } });
    expect(api.generate).toHaveBeenCalledWith(expect.objectContaining({ model: "image-model", config: {
      systemInstruction: "instructions", safetySettings: api.safetySettings, responseModalities: ["TEXT", "IMAGE"], tools: search ? [{ googleSearch: {} }] : undefined,
    } }));
  });
});
