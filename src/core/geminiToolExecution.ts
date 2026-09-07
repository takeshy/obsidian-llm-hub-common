import type { Attachment } from "./message.js";
import type { StreamChunk } from "./provider.js";
import { tracing } from "./tracingHooks.js";
import { dedupeAttachments, getToolResultAttachments, withoutToolResultAttachments } from "./toolResultAttachments.js";
import { prepareGeminiToolResult } from "./geminiTools.js";
import { planGeminiFunctionCalls, requestGeminiFunctionCallLimitExtension, type GeminiFunctionCallLimitExtensionOptions } from "./geminiToolLoop.js";

export type GeminiToolLimitPolicy =
  | { kind: "fixed" }
  | { kind: "extendable"; options: GeminiFunctionCallLimitExtensionOptions | undefined; defaultExtensionAmount: number };

/** Both APIs share accounting; hosts explicitly choose their limit/approval policy. */
export class GeminiToolBudget {
  used = 0;
  warned = false;
  constructor(public limit: number, readonly warningThreshold: number, readonly policy: GeminiToolLimitPolicy) {}

  async plan<T>(calls: T[]) {
    let plan = planGeminiFunctionCalls(calls, this.used, this.limit);
    let warning: string | undefined;
    const warningRemaining = this.policy.kind === "fixed" ? plan.remainingAfter : plan.remainingBefore;
    if (plan.remainingBefore > 0 && !this.warned && warningRemaining <= this.warningThreshold) {
      this.warned = true;
      if (this.policy.kind === "extendable") {
        this.limit = await requestGeminiFunctionCallLimitExtension(
          this.policy.options, this.policy.defaultExtensionAmount, this.used, this.limit, calls.length, plan.remainingBefore,
        );
        plan = planGeminiFunctionCalls(calls, this.used, this.limit);
      }
      const remaining = this.policy.kind === "fixed" ? plan.remainingAfter : plan.remainingBefore;
      warning = `\n\n[Note: ${remaining} function calls remaining. Please work efficiently.]`;
    }
    return { ...plan, warning };
  }
}

export interface GeminiExecutableCall { id?: string; name: string; args: Record<string, unknown> }
export interface GeminiToolExecutionState { output: string; toolCallCount: number }
export interface GeminiExecutedTools {
  results: Array<{ call: GeminiExecutableCall; serializedResult: string }>;
  attachments: Attachment[];
}

/** Execute sequentially so approval, stream display and trace order cannot diverge between APIs. */
export async function* executeGeminiTools(options: {
  calls: GeminiExecutableCall[];
  execute: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  state: GeminiToolExecutionState;
  traceId: string | null;
  generationId: string | null;
}): AsyncGenerator<StreamChunk, GeminiExecutedTools> {
  const results: GeminiExecutedTools["results"] = [];
  const attachments: Attachment[] = [];
  for (const call of options.calls) {
    const toolCall = { ...call, id: call.id ?? call.name };
    yield { type: "tool_call", toolCall };
    options.state.toolCallCount++;
    const span = tracing.spanStart(options.traceId, `tool:${call.name}`, {
      parentId: options.generationId ?? undefined, input: call.args, metadata: { toolName: call.name },
    });
    let result: unknown;
    try {
      result = await options.execute(call.name, call.args);
      tracing.spanEnd(span, { output: result });
    } catch (error) {
      tracing.spanEnd(span, { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    const cleanResult = withoutToolResultAttachments(result);
    const { serializedResult, trace } = prepareGeminiToolResult(call.name, call.args, cleanResult);
    options.state.output += trace;
    yield { type: "tool_result", toolResult: { toolCallId: toolCall.id, result: cleanResult } };
    results.push({ call, serializedResult });
    attachments.push(...getToolResultAttachments(result));
  }
  return { results, attachments: dedupeAttachments(attachments) };
}
