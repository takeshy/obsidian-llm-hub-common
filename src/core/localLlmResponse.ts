import type { StreamChunk } from "./provider.js";
import type { StreamChunkUsage } from "./usage.js";
import { parseThinkTags } from "./thinkTagParser.js";

/** NDJSON and SSE share thinking/tool accumulation and one terminal emission. */
export class LocalLlmResponseParser {
  done = false;
  private inThinkTag = false;
  private tagBuffer = "";
  private nativeThinking = false;
  private usage: StreamChunkUsage | undefined;
  private pending = new Map<number, { id: string; name: string; args: string }>();
  private emittedTool = false;
  constructor(readonly format: "ollama" | "openai", readonly createId = () => `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`) {}

  private tools(): StreamChunk[] {
    const chunks: StreamChunk[] = [];
    for (const call of this.pending.values()) {
      let args: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(call.args);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
      } catch { /* Keep malformed arguments as an empty object, as for native calls. */ }
      chunks.push({ type: "tool_call", toolCall: { id: call.id, name: call.name, args } });
      this.emittedTool = true;
    }
    this.pending.clear();
    return chunks;
  }

  finish(): StreamChunk[] {
    if (this.done) return [];
    this.done = true;
    return [
      ...this.tools(),
      ...(this.tagBuffer ? [{ type: this.inThinkTag ? "thinking" as const : "text" as const, content: this.tagBuffer }] : []),
      { type: "done", usage: this.usage },
    ];
  }

  push(line: string): StreamChunk[] {
    if (this.done) return [];
    let data = line.trim();
    if (!data) return [];
    if (this.format === "openai") {
      if (!data.startsWith("data:")) return [];
      data = data.slice(5).trimStart();
      if (data === "[DONE]") return this.finish();
    }
    let value: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(data);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
      value = parsed as Record<string, unknown>;
    } catch { return []; }
    const parsed = value as {
      error?: string | { message?: string }; message?: unknown;
      done?: boolean; prompt_eval_count?: number; eval_count?: number;
      choices?: Array<{ delta?: unknown; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    if (parsed.error) {
      this.done = true;
      return [{ type: "error", error: typeof parsed.error === "string" ? parsed.error
        : parsed.error.message || (typeof parsed.message === "string" ? parsed.message : "Unknown streaming error") }];
    }
    const delta = (this.format === "ollama" ? parsed.message : parsed.choices?.[0]?.delta) as {
      content?: string; thinking?: string; reasoning_content?: string; reasoning?: string;
      tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: unknown } }>;
    } | undefined;
    const chunks: StreamChunk[] = [];
    if (delta) {
      const thinking = this.format === "ollama" ? delta.thinking : delta.reasoning_content ?? delta.reasoning;
      if (thinking !== undefined) this.nativeThinking = true;
      if (thinking) chunks.push({ type: "thinking", content: thinking });
      if (this.format === "ollama") {
        for (const call of delta.tool_calls ?? []) {
          if (!call.function?.name) continue;
          const args = call.function.arguments;
          chunks.push({ type: "tool_call", toolCall: { id: call.id ?? this.createId(), name: call.function.name,
            args: args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : {},
          } });
        }
      } else {
        for (const call of delta.tool_calls ?? []) {
          const index = call.index ?? 0;
          const pending = this.pending.get(index) ?? { id: call.id ?? this.createId(), name: "", args: "" };
          if (call.id) pending.id = call.id;
          if (call.function?.name) pending.name += call.function.name;
          if (typeof call.function?.arguments === "string") pending.args += call.function.arguments;
          this.pending.set(index, pending);
        }
      }
      if (delta.content) {
        if (this.nativeThinking) chunks.push({ type: "text", content: delta.content });
        else {
          const parsedThink = parseThinkTags(delta.content, this.inThinkTag, this.tagBuffer);
          this.inThinkTag = parsedThink.inThinkTag;
          this.tagBuffer = parsedThink.tagBuffer;
          chunks.push(...parsedThink.items);
        }
      }
    }
    const reason = parsed.choices?.[0]?.finish_reason;
    if (reason === "tool_calls" || reason === "function_call") {
      if (this.pending.size === 0 && !this.emittedTool) chunks.push({ type: "incomplete_tool_call" });
      chunks.push(...this.tools());
    }
    if (this.format === "ollama" && parsed.done) {
      if (parsed.prompt_eval_count || parsed.eval_count) this.usage = {
        inputTokens: parsed.prompt_eval_count, outputTokens: parsed.eval_count,
        totalTokens: (parsed.prompt_eval_count ?? 0) + (parsed.eval_count ?? 0),
      };
      chunks.push(...this.finish());
    } else if (parsed.usage) {
      this.usage = { inputTokens: parsed.usage.prompt_tokens, outputTokens: parsed.usage.completion_tokens,
        totalTokens: parsed.usage.total_tokens,
      };
    }
    return chunks;
  }
}
