import type { Attachment, Message } from "./message.js";
import type { OpenAiToolDefinition, StreamChunk } from "./provider.js";
import { buildOpenAiMessages } from "./openAiMessages.js";
import { openaiPathPrefix } from "./modelListing.js";
import { getStreamIdleTimeoutMs, type NodeHttpModule } from "./localLlmStream.js";
import { streamLocalLlmLines } from "./localLlmTransport.js";
import { LocalLlmResponseParser } from "./localLlmResponse.js";
import { extractInlineToolCalls } from "./toolCallParser.js";
import { formatError } from "./error.js";

export interface LocalLlmStreamConfig {
  framework: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  streamIdleTimeoutSeconds?: number;
}

export interface OllamaChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  thinking?: string;
  tool_name?: string;
  tool_calls?: Array<{ type: "function"; function: { name: string; arguments: Record<string, unknown> } }>;
}

/** Reuse answered-tool/history normalization while adapting to Ollama's native content shape. */
export function buildOllamaMessages(messages: Message[], systemPrompt: string): OllamaChatMessage[] {
  const wire = buildOpenAiMessages(messages, systemPrompt);
  const toolNames = new Map<string, string>();
  for (const message of messages) {
    for (const call of message.toolCalls ?? []) toolNames.set(call.id, call.name);
    if (message.toolCallId && message.toolName) toolNames.set(message.toolCallId, message.toolName);
  }
  return wire.map(message => {
    const content = Array.isArray(message.content)
      ? message.content.filter(part => part.type === "text").map(part => part.text).join("\n")
      : message.content ?? "";
    const images = Array.isArray(message.content)
      ? message.content.filter(part => part.type === "image_url").map(part => part.image_url.url.replace(/^data:[^,]*,/, "")) : [];
    return {
      role: message.role, content,
      ...(images.length ? { images } : {}),
      ...(message.reasoning_content ? { thinking: message.reasoning_content } : {}),
      ...(message.role === "tool" ? { tool_name: toolNames.get(message.tool_call_id ?? "") } : {}),
      ...(message.tool_calls ? { tool_calls: message.tool_calls.map(call => ({
        type: "function" as const, function: { name: call.function.name, arguments: JSON.parse(call.function.arguments) as Record<string, unknown> },
      })) } : {}),
    };
  });
}

export function buildLocalLlmRequest(options: {
  config: LocalLlmStreamConfig; messages: Message[]; systemPrompt: string;
  attachments?: Attachment[]; tools?: OpenAiToolDefinition[];
}): { url: URL; body: string; headers: Record<string, string>; format: "ollama" | "openai" } {
  const { config, systemPrompt, tools } = options;
  const messages = options.messages.map((message, index) => index === options.messages.length - 1 && message.role === "user" && options.attachments?.length
    ? { ...message, attachments: [...(message.attachments ?? []), ...options.attachments.filter(attachment => !message.attachments?.some(existing => existing.data === attachment.data && existing.mimeType === attachment.mimeType))] }
    : message);
  const format = config.framework === "ollama" ? "ollama" : "openai";
  const request: Record<string, unknown> = {
    model: config.model, stream: true,
    messages: format === "ollama" ? buildOllamaMessages(messages, systemPrompt) : buildOpenAiMessages(messages, systemPrompt),
  };
  if (format === "ollama") {
    const settings: Record<string, number> = {};
    if (config.temperature != null) settings.temperature = config.temperature;
    if (config.maxTokens != null) settings.num_predict = config.maxTokens;
    if (Object.keys(settings).length) request.options = settings;
  } else {
    if (config.temperature != null) request.temperature = config.temperature;
    if (config.maxTokens != null) request.max_tokens = config.maxTokens;
  }
  // AnythingLLM accepts inline tool instructions, but its endpoint rejects the tools field.
  if (tools?.length && config.framework !== "anythingllm") request.tools = tools;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  const suffix = format === "ollama" ? "/api/chat" : `${openaiPathPrefix(config.framework)}/chat/completions`;
  return { url: new URL(config.baseUrl.replace(/\/+$/, "") + suffix), body: JSON.stringify(request), headers, format };
}

/** One local server round. Provider routing and the caller's tool execution loop remain outside. */
export async function* runLocalLlmChat(options: {
  config: LocalLlmStreamConfig; messages: Message[]; systemPrompt: string;
  signal?: AbortSignal; attachments?: Attachment[]; tools?: OpenAiToolDefinition[];
  http?: NodeHttpModule;
}): AsyncGenerator<StreamChunk> {
  if (options.signal?.aborted) return;
  try {
    const request = buildLocalLlmRequest(options);
    const parser = new LocalLlmResponseParser(request.format);
    let text = "";
    let nativeTool = false;
    const activeTools = options.tools?.map(tool => tool.function.name) ?? [];
    const emit = function* (chunks: StreamChunk[]): Generator<StreamChunk> {
      for (const chunk of chunks) {
        if (chunk.type === "text") text += chunk.content ?? "";
        if (chunk.type === "tool_call") nativeTool = true;
        if (chunk.type === "done" && !nativeTool && activeTools.length && text.trim()) {
          const fallback = extractInlineToolCalls(text, activeTools);
          if (fallback.toolCalls.length) {
            yield { type: "replace_text", content: fallback.cleanedText };
            for (const toolCall of fallback.toolCalls) yield { type: "tool_call", toolCall };
          }
        }
        yield chunk;
      }
    };
    for await (const line of streamLocalLlmLines({ ...request, signal: options.signal,
      idleTimeoutMs: getStreamIdleTimeoutMs(options.config), http: options.http,
    })) {
      yield* emit(parser.push(line));
      if (parser.done) return;
    }
    if (!options.signal?.aborted) yield* emit(parser.finish());
  } catch (error) {
    if (!options.signal?.aborted) yield { type: "error", error: formatError(error) };
  }
}
