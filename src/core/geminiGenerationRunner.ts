import type { StreamChunk } from "./provider.js";
import type { WebSearchSource } from "./message.js";
import { tracing, type TracingUsage } from "./tracingHooks.js";
import { formatError } from "./error.js";
import { accumulateGeminiUsage, extractGeminiUsage, getGeminiFinishReasonError, toGeminiStreamChunkUsage, type GeminiUsageMetadata } from "./geminiUsage.js";
import { collectGeminiWebSources, extractGeminiGroundingWebSearch, parseGeminiGenerateContentParts } from "./geminiTools.js";
import { executeGeminiTools, GeminiToolBudget, type GeminiExecutableCall, type GeminiToolLimitPolicy } from "./geminiToolExecution.js";

/** SDK-neutral structural shapes. Original parts are retained intact, including thought signatures. */
export interface GeminiGenerationPart {
  text?: string;
  thought?: boolean;
  inlineData?: { mimeType?: string; data?: string };
  functionCall?: unknown;
  functionResponse?: { id?: string; name?: string; response?: Record<string, unknown> };
}
export interface GeminiGenerationContent { role?: string; parts?: GeminiGenerationPart[] }
export interface GeminiGenerationResponse {
  text?: string;
  usageMetadata?: GeminiUsageMetadata;
  candidates?: Array<{ finishReason?: string; content?: { parts?: GeminiGenerationPart[] } }>;
}

export async function* runGeminiGenerateContentTools(options: {
  contents: GeminiGenerationContent[];
  model: string;
  traceId: string | null;
  generationId: string | null;
  maxFunctionCalls: number;
  warningThreshold: number;
  limitPolicy: GeminiToolLimitPolicy;
  executeToolCall?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  create: (contents: GeminiGenerationContent[], finalRound: boolean) => Promise<AsyncIterable<GeminiGenerationResponse>>;
}): AsyncGenerator<StreamChunk> {
  const { traceId, generationId, model } = options;
  const budget = new GeminiToolBudget(options.maxFunctionCalls, options.warningThreshold, options.limitPolicy);
  const execution = { output: "", toolCallCount: 0 };
  const totalUsage: TracingUsage = { input: 0, output: 0, total: 0 };
  const webSources: WebSearchSource[] = [];
  let contents = options.contents;
  let roundNumber = 0;
  let webSearchUsed = false;
  let finalRound = false;
  const metadata = () => ({ toolCallCount: execution.toolCallCount, roundCount: roundNumber, useGenerateContentApi: true });
  try {
    while (true) {
      roundNumber++;
      const stream = await options.create(contents, finalRound);
      const modelParts: GeminiGenerationPart[] = [];
      const calls: GeminiExecutableCall[] = [];
      let rawUsage: GeminiUsageMetadata | undefined;
      let received = false;
      let roundSearchUsed = false;
      for await (const chunk of stream) {
        received = true;
        if (chunk.usageMetadata) rawUsage = chunk.usageMetadata;
        const error = getGeminiFinishReasonError(chunk.candidates);
        if (error) {
          if (rawUsage) accumulateGeminiUsage(totalUsage, extractGeminiUsage(rawUsage, { model, webSearchUsed: roundSearchUsed })!);
          throw new Error(error);
        }
        const grounding = extractGeminiGroundingWebSearch(chunk);
        if (grounding.used) {
          roundSearchUsed = true;
          if (!webSearchUsed) { webSearchUsed = true; yield { type: "web_search_used" }; }
          for (const source of grounding.sources) collectGeminiWebSources(source, webSources);
        }
        const parts = chunk.candidates?.[0]?.content?.parts ?? [];
        modelParts.push(...parts);
        const parsed = parseGeminiGenerateContentParts(parts);
        calls.push(...parsed.functionCalls);
        for (const segment of parsed.textSegments) {
          if (segment.type === "text") execution.output += segment.content;
          yield segment;
        }
        if (parsed.webSearchResponses.length > 0) {
          roundSearchUsed = true;
          if (!webSearchUsed) { webSearchUsed = true; yield { type: "web_search_used" }; }
          for (const response of parsed.webSearchResponses) collectGeminiWebSources(response, webSources);
        }
      }
      // Price after all chunks: search invocations can arrive after usage metadata.
      const usage = extractGeminiUsage(rawUsage, { model, webSearchUsed: roundSearchUsed });
      if (usage) accumulateGeminiUsage(totalUsage, usage);
      if (!received) throw new Error("No response received from API (possible server error)");
      if (modelParts.length > 0) contents = [...contents, { role: "model", parts: modelParts }];
      if (finalRound || calls.length === 0 || !options.executeToolCall) break;
      const plan = await budget.plan(calls);
      const finalPrompt = "Function call limit reached. Please provide a final answer based on the information gathered so far.";
      if (plan.remainingBefore <= 0) {
        contents = [...contents, { role: "user", parts: [{ text: finalPrompt }] }];
        finalRound = true;
        continue;
      }
      if (plan.warning) yield { type: "text", content: plan.warning };
      const executed = yield* executeGeminiTools({ calls: plan.callsToExecute, execute: options.executeToolCall,
        state: execution, traceId, generationId,
      });
      budget.used += executed.results.length;
      const responseParts: GeminiGenerationPart[] = executed.results.map(({ call, serializedResult }) => ({
        functionResponse: { id: call.id, name: call.name, response: { output: serializedResult } },
      }));
      responseParts.push(...executed.attachments.map(attachment => ({ inlineData: { mimeType: attachment.mimeType, data: attachment.data } })));
      if (plan.skippedCount > 0 || budget.used >= budget.limit) {
        responseParts.push({ text: finalPrompt });
        finalRound = true;
      }
      contents = [...contents, { role: "user", parts: responseParts }];
    }
    tracing.generationEnd(generationId, { output: execution.output, usage: totalUsage.total ? totalUsage : undefined, metadata: metadata() });
    yield { type: "done", usage: toGeminiStreamChunkUsage(totalUsage.total ? totalUsage : undefined),
      webSearchSources: webSources.length > 0 ? webSources : undefined,
    };
  } catch (error) {
    const message = formatError(error);
    tracing.generationEnd(generationId, { error: message, usage: totalUsage.total ? totalUsage : undefined, metadata: metadata() });
    yield { type: "error", error: message };
  }
}
