import type { StreamChunk } from "./provider.js";
import { tracing, type TracingUsage } from "./tracingHooks.js";
import { formatError } from "./error.js";
import { extractGeminiUsage, extractGeminiInteractionsUsage, getGeminiFinishReasonError, toGeminiStreamChunkUsage, type GeminiInteractionsUsage } from "./geminiUsage.js";
import type { GeminiGenerationResponse } from "./geminiGenerationRunner.js";

interface GeminiGenerationTrace {
  model: string;
  input?: string;
  traceId?: string | null;
}

export async function runGeminiChat(options: GeminiGenerationTrace & {
  generate: () => Promise<GeminiGenerationResponse>;
}): Promise<string> {
  const id = tracing.generationStart(options.traceId ?? null, "chat", { model: options.model, input: options.input });
  try {
    const response = await options.generate();
    const error = getGeminiFinishReasonError(response.candidates);
    if (error) throw new Error(error);
    const text = response.text ?? "";
    tracing.generationEnd(id, { output: text, usage: extractGeminiUsage(response.usageMetadata, { model: options.model }) });
    return text;
  } catch (error) {
    tracing.generationEnd(id, { error: formatError(error) });
    throw error;
  }
}

/** Chat and workflow generation share stream lifecycle; workflow also emits thought summaries. */
export async function* runGeminiTextStream(options: GeminiGenerationTrace & {
  mode: { kind: "chatStream" } | { kind: "generateWorkflowStream"; enableThinking: boolean };
  generate: () => Promise<AsyncIterable<GeminiGenerationResponse>>;
}): AsyncGenerator<StreamChunk> {
  const id = tracing.generationStart(options.traceId ?? null, options.mode.kind, {
    model: options.model, input: options.input,
    ...(options.mode.kind === "generateWorkflowStream" ? { metadata: { enableThinking: options.mode.enableThinking } } : {}),
  });
  let usage: TracingUsage | undefined;
  try {
    const stream = await options.generate();
    let received = false;
    let text = "";
    for await (const chunk of stream) {
      received = true;
      if (chunk.usageMetadata) usage = extractGeminiUsage(chunk.usageMetadata, { model: options.model });
      const error = getGeminiFinishReasonError(chunk.candidates);
      if (error) throw new Error(error);
      if (options.mode.kind === "generateWorkflowStream") {
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          if (part.thought && part.text) yield { type: "thinking", content: part.text };
        }
      }
      if (chunk.text) { text += chunk.text; yield { type: "text", content: chunk.text }; }
    }
    if (!received) throw new Error("No response received from API (possible server error)");
    tracing.generationEnd(id, { output: text, usage });
    yield { type: "done", usage: toGeminiStreamChunkUsage(usage) };
  } catch (error) {
    const message = formatError(error);
    tracing.generationEnd(id, { error: message, usage });
    yield { type: "error", error: message };
  }
}

export async function* runGeminiImageGeneration(options: GeminiGenerationTrace & {
  webSearchEnabled: boolean;
  generate: () => Promise<GeminiGenerationResponse>;
}): AsyncGenerator<StreamChunk> {
  const id = tracing.generationStart(options.traceId ?? null, "generateImageStream", {
    model: options.model, input: options.input, metadata: { webSearchEnabled: options.webSearchEnabled },
  });
  try {
    const response = await options.generate();
    const error = getGeminiFinishReasonError(response.candidates);
    if (error) throw new Error(error);
    if (options.webSearchEnabled) yield { type: "web_search_used" };
    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if (part.text) yield { type: "text", content: part.text };
      if (part.inlineData?.mimeType && part.inlineData.data) {
        yield { type: "image_generated", generatedImage: { mimeType: part.inlineData.mimeType, data: part.inlineData.data } };
      }
    }
    const usage = extractGeminiUsage(response.usageMetadata, { model: options.model, webSearchUsed: options.webSearchEnabled });
    tracing.generationEnd(id, { output: "[image generation completed]", usage });
    yield { type: "done", usage: toGeminiStreamChunkUsage(usage) };
  } catch (error) {
    const message = formatError(error);
    tracing.generationEnd(id, { error: message });
    yield { type: "error", error: message };
  }
}

export const GEMINI_DEEP_RESEARCH_AGENT = "deep-research-pro-preview-12-2025";
export interface GeminiResearchResult {
  status?: string;
  output_text?: string;
  steps?: unknown[];
  usage?: GeminiInteractionsUsage;
}

export function extractGeminiResearchText(result: GeminiResearchResult): string {
  if (result.output_text) return result.output_text;
  let text = "";
  if (!Array.isArray(result.steps)) return text;
  for (const step of result.steps as Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>) {
    if (step?.type !== "model_output" || !Array.isArray(step.content)) continue;
    for (const content of step.content) if (content?.type === "text" && content.text) text += content.text;
  }
  return text;
}

export async function* runGeminiDeepResearch(options: {
  query: string;
  traceId?: string | null;
  create: () => Promise<{ id: string }>;
  get: (id: string) => Promise<GeminiResearchResult>;
  delay: (milliseconds: number) => Promise<void>;
}): AsyncGenerator<StreamChunk> {
  const id = tracing.generationStart(options.traceId ?? null, "deepResearch", { model: GEMINI_DEEP_RESEARCH_AGENT, input: options.query });
  try {
    const interaction = await options.create();
    yield { type: "text", content: "Deep Research started. Polling for results...\n\n" };
    for (let i = 0; i < 180; i++) {
      await options.delay(10000);
      const result = await options.get(interaction.id);
      if (result.status === "completed") {
        const text = extractGeminiResearchText(result);
        if (text) yield { type: "text", content: text };
        const usage = extractGeminiInteractionsUsage(result.usage, GEMINI_DEEP_RESEARCH_AGENT);
        tracing.generationEnd(id, { output: text, usage });
        yield { type: "done", usage: toGeminiStreamChunkUsage(usage), interactionId: interaction.id };
        return;
      }
      if (result.status === "failed" || result.status === "cancelled") throw new Error(`Deep Research ${result.status}`);
      if (i % 3 === 0 && i > 0) yield { type: "text", content: "." };
    }
    throw new Error("Deep Research timed out after 30 minutes");
  } catch (error) {
    const message = formatError(error);
    tracing.generationEnd(id, { error: message });
    yield { type: "error", error: message };
  }
}
