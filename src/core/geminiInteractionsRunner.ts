import type { StreamChunk } from "./provider.js";
import type { WebSearchSource } from "./message.js";
import { tracing, type TracingUsage } from "./tracingHooks.js";
import { formatError } from "./error.js";
import { createGeminiInteractionRound, reduceGeminiInteractionEvent, type GeminiInteractionSearchPolicy } from "./geminiInteractionStream.js";
import { buildGeminiInteractionAttachmentStep, buildGeminiInteractionFunctionResultStep, buildGeminiInteractionTextStep, type GeminiInteractionInputStep } from "./geminiInteractions.js";
import { accumulateGeminiUsage, extractGeminiInteractionsUsage, GEMINI_SEARCH_GROUNDING_COST, toGeminiStreamChunkUsage, type GeminiInteractionsUsage } from "./geminiUsage.js";
import { collectGeminiWebSources } from "./geminiTools.js";
import { executeGeminiTools, GeminiToolBudget, type GeminiToolLimitPolicy, type GeminiToolMode } from "./geminiToolExecution.js";

export interface GeminiInteractionsRunnerOptions<Input> {
  input: Input;
  previousInteractionId?: string;
  model: string;
  traceId: string | null;
  generationId: string | null;
  searchPolicy: GeminiInteractionSearchPolicy;
  ragAlreadyEmitted: boolean;
  maxFunctionCalls: number;
  warningThreshold: number;
  limitPolicy: GeminiToolLimitPolicy;
  executeToolCall?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  create: (request: {
    input: Input | string | GeminiInteractionInputStep[];
    previousInteractionId?: string;
    toolMode: GeminiToolMode;
  }) => Promise<AsyncIterable<unknown>>;
}

/** Own the full Interactions tool loop; SDK request construction and RAG retrieval stay in the host. */
export async function* runGeminiInteractions<Input>(options: GeminiInteractionsRunnerOptions<Input>): AsyncGenerator<StreamChunk> {
  const { traceId, generationId, model } = options;
  const budget = new GeminiToolBudget(options.maxFunctionCalls, options.warningThreshold, options.limitPolicy);
  const execution = { output: "", toolCallCount: 0 };
  const totalUsage: TracingUsage = { input: 0, output: 0, total: 0 };
  const webSources: WebSearchSource[] = [];
  let roundNumber = 0;
  let interactionId: string | undefined;
  let input: Input | string | GeminiInteractionInputStep[] = options.input;
  let finalRound = false;
  let ragEmitted = options.ragAlreadyEmitted;
  let roundSpan: string | null = null;
  const metadata = () => ({ toolCallCount: execution.toolCallCount, roundCount: roundNumber });
  try {
    while (true) {
      roundNumber++;
      roundSpan = tracing.spanStart(traceId, `round-${roundNumber}`, {
        parentId: generationId ?? undefined, metadata: { roundNumber, final: finalRound },
      });
      const stream = await options.create({ input,
        previousInteractionId: roundNumber === 1 ? options.previousInteractionId : interactionId, toolMode: finalRound ? "built-in-only" : "all",
      });
      let round = createGeminiInteractionRound(options.searchPolicy);
      let roundError: string | undefined;
      events: for await (const event of stream) {
        const reduced = reduceGeminiInteractionEvent(round, event);
        round = reduced.state;
        if (round.interactionId !== undefined) interactionId = round.interactionId;
        for (const effect of reduced.effects) {
          if (effect.type === "text") execution.output += effect.content;
          if (effect.type === "error") {
            roundError = effect.error;
            // A terminal API error must not wait for another event or EOF.
            // Leaving the iterator also releases the underlying SDK stream.
            break events;
          }
          yield effect;
        }
      }
      const usage = extractGeminiInteractionsUsage(round.usage as GeminiInteractionsUsage | undefined, model);
      if (usage) accumulateGeminiUsage(totalUsage, usage);
      if (round.webSearchUsed && GEMINI_SEARCH_GROUNDING_COST[model] !== undefined) {
        totalUsage.totalCost = (totalUsage.totalCost ?? 0) + GEMINI_SEARCH_GROUNDING_COST[model];
      }
      for (const source of round.webSources) collectGeminiWebSources(source, webSources);
      if (roundError) throw new Error(roundError);
      if (!round.hasReceivedEvent) throw new Error("No response received from API (possible server error)");
      if (!ragEmitted && (options.searchPolicy === "native"
        ? round.fileSearchUsed : round.sources.length > 0 && !round.webSearchUsed)) {
        yield { type: "rag_used", ragSources: round.sources,
          ...(options.searchPolicy === "native" ? { ragContexts: round.contexts } : {}),
        };
        ragEmitted = true;
      }
      if (finalRound || round.functionCalls.length === 0 || !options.executeToolCall) {
        tracing.spanEnd(roundSpan, { metadata: { final: true, usage } });
        roundSpan = null;
        break;
      }
      const plan = await budget.plan(round.functionCalls);
      if (plan.remainingBefore <= 0) {
        yield { type: "text", content: "\n\n[Function call limit reached. Summarizing with available information...]" };
        input = "You have reached the function call limit. Please provide a final answer based on the information gathered so far.";
        finalRound = true;
        tracing.spanEnd(roundSpan, { metadata: { reason: "function_call_limit", usage } });
        roundSpan = null;
        continue;
      }
      if (plan.warning) yield { type: "text", content: plan.warning };
      const executed = yield* executeGeminiTools({ calls: plan.callsToExecute, execute: options.executeToolCall,
        state: execution, traceId, generationId,
      });
      budget.used += executed.results.length;
      const steps = executed.results.map(({ call, serializedResult }) =>
        buildGeminiInteractionFunctionResultStep(call.id, call.name, serializedResult));
      const attachmentStep = buildGeminiInteractionAttachmentStep(executed.attachments);
      if (attachmentStep) steps.push(attachmentStep);
      if (plan.skippedCount > 0 || budget.used >= budget.limit) {
        const skipped = plan.skippedCount > 0 ? ` (${plan.skippedCount} additional calls were skipped)` : "";
        yield { type: "text", content: `\n\n[Function call limit reached${skipped}. Summarizing with available information...]` };
        steps.push(buildGeminiInteractionTextStep("[System: Function call limit reached. Please provide a final answer based on the information gathered so far.]"));
        finalRound = true;
      } else if (budget.warned && budget.limit - budget.used <= budget.warningThreshold) {
        steps.push(buildGeminiInteractionTextStep(`[System: You have ${budget.limit - budget.used} function calls remaining. Please complete your task efficiently or provide a summary.]`));
      }
      input = steps;
      tracing.spanEnd(roundSpan, { metadata: { toolCalls: plan.callsToExecute.map(call => call.name), usage,
        ...(finalRound ? { reason: "function_call_limit_with_skipped" } : {}),
      } });
      roundSpan = null;
    }
    const generationMetadata: Record<string, unknown> = metadata();
    if (totalUsage.toolUsePromptTokens) {
      generationMetadata.toolUsePromptTokens = totalUsage.toolUsePromptTokens;
      if (totalUsage.total) generationMetadata.ragTokenRatio = totalUsage.toolUsePromptTokens / totalUsage.total;
    }
    tracing.generationEnd(generationId, { output: execution.output, usage: totalUsage.total ? totalUsage : undefined, metadata: generationMetadata });
    yield { type: "done", usage: toGeminiStreamChunkUsage(totalUsage.total ? totalUsage : undefined), interactionId,
      webSearchSources: webSources.length > 0 ? webSources : undefined,
    };
  } catch (error) {
    const message = formatError(error);
    tracing.spanEnd(roundSpan, { error: message });
    tracing.generationEnd(generationId, { error: message, usage: totalUsage.total ? totalUsage : undefined, metadata: metadata() });
    yield { type: "error", error: message };
  }
}
