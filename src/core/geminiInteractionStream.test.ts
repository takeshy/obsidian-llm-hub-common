import { describe, expect, it } from "vitest";
import { createGeminiInteractionRound, reduceGeminiInteractionEvent, type GeminiInteractionRoundState } from "./geminiInteractionStream.js";

function replay(events: unknown[], policy: "native" | "pre-retrieved" = "native") {
  let state = createGeminiInteractionRound(policy);
  const effects = [];
  for (const event of events) {
    const result = reduceGeminiInteractionEvent(state, event);
    state = result.state;
    effects.push(...result.effects);
  }
  return { state, effects };
}
function freeze(value: unknown): void {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
}

describe("Gemini Interactions round reducer", () => {
  it("preserves output order and separates thinking from response text", () => {
    expect(replay([
      { event_type: "interaction.created", interaction: { id: "round-1" } },
      { event_type: "step.delta", delta: { type: "thought_summary", content: { text: "thinking" } } },
      { event_type: "step.delta", delta: { type: "text", text: "answer" } },
      { event_type: "step.delta", delta: { type: "text", text: "" } },
    ])).toMatchObject({ state: { interactionId: "round-1", hasReceivedEvent: true }, effects: [
      { type: "thinking", content: "thinking" }, { type: "text", content: "answer" },
    ] });
  });

  it("assembles interleaved calls, falls back on malformed JSON and ignores duplicate stops", () => {
    const { state } = replay([
      { event_type: "step.start", index: 1, step: { type: "function_call", id: "a", name: "search", arguments: {} } },
      { event_type: "step.start", index: 2, step: { type: "function_call", id: "b", name: "read", arguments: { path: "note" } } },
      { event_type: "step.delta", index: 1, delta: { type: "arguments_delta", arguments: '{"query":' } },
      { event_type: "step.delta", index: 2, delta: { type: "arguments_delta", arguments: '{broken' } },
      { event_type: "step.delta", index: 1, delta: { type: "arguments_delta", arguments: '"hello"}' } },
      { event_type: "step.stop", index: 2 }, { event_type: "step.stop", index: 1 }, { event_type: "step.stop", index: 1 },
    ]);
    expect(state.functionCalls).toEqual([
      { id: "b", name: "read", args: { path: "note" } }, { id: "a", name: "search", args: { query: "hello" } },
    ]);
    expect(state.pendingCalls).toEqual({});
  });

  it.each(["usage", "total_usage"])("reads status metadata.%s and lets completed usage replace it", field => {
    let state = replay([{ event_type: "interaction.status_update", metadata: { [field]: { total_tokens: 3 } } }]).state;
    expect(state.usage).toEqual({ total_tokens: 3 });
    state = reduceGeminiInteractionEvent(state, { event_type: "interaction.completed", interaction: { status: "completed", usage: { total_tokens: 7 } } }).state;
    expect(state.usage).toEqual({ total_tokens: 7 });
  });

  it("prefers total_usage and retains usage when completion omits it", () => {
    expect(replay([
      { event_type: "interaction.status_update", metadata: { total_usage: { total_tokens: 7 }, usage: { total_tokens: 3 } } },
      { event_type: "interaction.completed", interaction: { status: "requires_action" } },
    ])).toMatchObject({ state: { usage: { total_tokens: 7 } }, effects: [] });
  });

  it.each(["native", "pre-retrieved"] as const)("collects all web results but emits search once per %s round", policy => {
    const { state, effects } = replay([
      { event_type: "step.delta", delta: { type: "google_search_result" } },
      ...["https://a.test", "https://b.test", "https://a.test"].map(url => ({ event_type: "step.delta", delta: { type: "google_search_result", result: [{ url, title: url }] } })),
    ], policy);
    expect(effects).toEqual([{ type: "web_search_used" }]);
    expect(state.webSources.map(source => source.url)).toEqual(["https://a.test", "https://b.test"]);
    expect(createGeminiInteractionRound(policy).webSearchUsed).toBe(false);
  });

  it("keeps native annotations/context fallback separate from pre-retrieved RAG", () => {
    const events = [
      { event_type: "step.start", step: { type: "file_search_call" } },
      { event_type: "step.delta", delta: { type: "file_search_call" } },
      { event_type: "step.delta", delta: { type: "text_annotation_delta", annotations: [{ file_name: "citation" }] } },
      { event_type: "step.delta", delta: { type: "file_search_result", result: [{ title: "note", text: "excerpt" }] } },
      { event_type: "interaction.completed", interaction: { steps: [{ type: "file_search_result", result: [{ title: "fallback", text: "more" }, { title: "note", text: "excerpt" }] }] } },
    ];
    expect(replay(events).state).toMatchObject({ fileSearchUsed: true, sources: ["citation", "note", "fallback"], contexts: [{ source: "note", text: "excerpt" }, { source: "fallback", text: "more" }] });
    expect(replay(events, "pre-retrieved").state).toMatchObject({ fileSearchUsed: false, sources: ["note"], contexts: [] });
  });

  it("returns errors after updating usage for tracing", () => {
    expect(replay([{ event_type: "interaction.completed", interaction: { status: "failed", usage: { total_tokens: 5 } } }])).toMatchObject({
      state: { usage: { total_tokens: 5 } }, effects: [{ type: "error", error: "Response failed (possibly blocked by safety filters)" }],
    });
    expect(replay([{ event_type: "error", error: { message: "failure" } }, { event_type: "error" }]).effects).toEqual([
      { type: "error", error: "failure" }, { type: "error", error: "Unknown interaction error" },
    ]);
  });

  it("does not mutate prior states and tolerates unknown or incomplete events", () => {
    let state: GeminiInteractionRoundState = createGeminiInteractionRound("native");
    expect(state.hasReceivedEvent).toBe(false);
    for (const event of [null, { event_type: "future" }, { event_type: "step.delta" },
      { event_type: "step.start", index: 0, step: { type: "function_call", id: "id", name: "tool", arguments: {} } },
      { event_type: "step.delta", index: 0, delta: { type: "arguments_delta", arguments: "{}" } },
      { event_type: "step.stop", index: 0 },
      { event_type: "step.delta", delta: { type: "file_search_result", result: [{ title: "note", text: "text" }] } },
    ]) {
      const snapshot = JSON.stringify(state);
      freeze(state);
      const previous = state;
      state = reduceGeminiInteractionEvent(state, event).state;
      expect(JSON.stringify(previous)).toBe(snapshot);
    }
    expect(state.functionCalls).toHaveLength(1);
    expect(state.sources).toEqual(["note"]);
  });
});
