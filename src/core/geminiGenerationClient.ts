import type { Message } from "./message.js";
import type { StreamChunk } from "./provider.js";
import { buildGeminiMessageParts, messagesToGeminiContents, type GeminiContent, type GeminiContentPart } from "./geminiInteractions.js";
import { buildGeminiThinkingConfig } from "./geminiThinking.js";
import { GEMINI_DEEP_RESEARCH_AGENT, runGeminiChat, runGeminiTextStream, runGeminiDeepResearch, runGeminiImageGeneration, type GeminiResearchResult } from "./geminiChatRunners.js";
import type { GeminiGenerationResponse } from "./geminiGenerationRunner.js";

export interface GeminiGenerationRequest {
  model: string;
  contents: GeminiContent[];
  config: Record<string, unknown>;
}

/** SDK construction, proxy transport and platform/model capabilities belong to the adapter. */
export interface GeminiGenerationSdk {
  generate(request: GeminiGenerationRequest): Promise<GeminiGenerationResponse>;
  stream(request: GeminiGenerationRequest): Promise<AsyncIterable<GeminiGenerationResponse>>;
  chat(request: { model: string; history: GeminiContent[]; config: Record<string, unknown> }): {
    sendMessageStream(request: { message: GeminiContentPart[] }): Promise<AsyncIterable<GeminiGenerationResponse>>;
  };
  createResearch(request: { agent: string; input: string; background: true; store: true; previous_interaction_id?: string }): Promise<{ id: string }>;
  getResearch(id: string): Promise<GeminiResearchResult>;
  delay(milliseconds: number): Promise<void>;
  safetySettings: readonly unknown[];
  supportsThinking(model: string): boolean;
}

/** Identical non-tool methods are inherited by both hosts, including request construction. */
export class GeminiGenerationClient<Model extends string = string> {
  constructor(protected model: Model, private readonly sdk: GeminiGenerationSdk) {}
  getModel(): Model { return this.model; }
  setModel(model: Model): void { this.model = model; }
  protected supportsThinking(): boolean { return this.sdk.supportsThinking(this.model); }

  async chat(messages: Message[], systemPrompt?: string, traceId?: string | null): Promise<string> {
    return runGeminiChat({ model: this.model, input: messages.at(-1)?.content, traceId,
      generate: () => this.sdk.generate({ model: this.model, contents: messagesToGeminiContents(messages),
        config: { systemInstruction: systemPrompt, safetySettings: this.sdk.safetySettings },
      }),
    });
  }

  async *chatStream(messages: Message[], systemPrompt?: string, traceId?: string | null): AsyncGenerator<StreamChunk> {
    yield* runGeminiTextStream({ mode: { kind: "chatStream" }, model: this.model, input: messages.at(-1)?.content, traceId,
      generate: () => this.sdk.stream({ model: this.model, contents: messagesToGeminiContents(messages),
        config: { systemInstruction: systemPrompt, safetySettings: this.sdk.safetySettings },
      }),
    });
  }

  async *generateWorkflowStream(messages: Message[], systemPrompt?: string, traceId?: string | null): AsyncGenerator<StreamChunk> {
    const lastMessage = messages.at(-1);
    if (!lastMessage || lastMessage.role !== "user") { yield { type: "error", error: "No user message to send" }; return; }
    const thinkingConfig = this.supportsThinking() ? buildGeminiThinkingConfig(this.model, true) : undefined;
    const enableThinking = thinkingConfig !== undefined;
    yield* runGeminiTextStream({ mode: { kind: "generateWorkflowStream", enableThinking }, model: this.model, input: lastMessage.content, traceId,
      generate: () => this.sdk.chat({ model: this.model, history: messagesToGeminiContents(messages.slice(0, -1)),
        config: { systemInstruction: systemPrompt, safetySettings: this.sdk.safetySettings,
          thinkingConfig,
        },
      }).sendMessageStream({ message: buildGeminiMessageParts(lastMessage) }),
    });
  }

  async *deepResearchStream(query: string, previousInteractionId?: string | null, traceId?: string | null): AsyncGenerator<StreamChunk> {
    yield* runGeminiDeepResearch({ query, traceId,
      create: () => this.sdk.createResearch({ agent: GEMINI_DEEP_RESEARCH_AGENT, input: query,
        background: true, store: true, previous_interaction_id: previousInteractionId ?? undefined,
      }),
      get: id => this.sdk.getResearch(id), delay: milliseconds => this.sdk.delay(milliseconds),
    });
  }

  async *generateImageStream(messages: Message[], imageModel: Model, systemPrompt?: string,
    webSearchEnabled?: boolean, _ragStoreIds?: string[], traceId?: string | null): AsyncGenerator<StreamChunk> {
    const lastMessage = messages.at(-1);
    if (!lastMessage || lastMessage.role !== "user") { yield { type: "error", error: "No user message to send" }; return; }
    yield* runGeminiImageGeneration({ model: imageModel, input: lastMessage.content, traceId, webSearchEnabled: !!webSearchEnabled,
      generate: () => this.sdk.generate({ model: imageModel,
        contents: [...messagesToGeminiContents(messages.slice(0, -1)), { role: "user", parts: buildGeminiMessageParts(lastMessage) }],
        config: { systemInstruction: systemPrompt, safetySettings: this.sdk.safetySettings,
          responseModalities: ["TEXT", "IMAGE"], tools: webSearchEnabled ? [{ googleSearch: {} }] : undefined,
        },
      }),
    });
  }
}
