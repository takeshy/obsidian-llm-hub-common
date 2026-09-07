import { beforeEach, describe, expect, it, vi } from "vitest";
import { runChatTurn, type ChatTurnUi } from "./chatTurn.js";
import type { Message } from "../core/message.js";
import { setTracingHandler, type TracingHandler } from "../core/tracingHooks.js";

const user = (content: string): Message => ({ role: "user", content, timestamp: 1 });
const assistant = (content: string): Message => ({ role: "assistant", content, timestamp: 2 });

interface Harness {
  ui: ChatTurnUi;
  saved: Message[][];
  onScreen: () => Message[];
  loading: boolean[];
  cleanedUp: AbortController[];
  detach: () => void;
  traces: { ended: { output?: unknown; metadata?: unknown }[]; scores: { value: number; comment?: string }[] };
}

function harness(history: Message[] = []): Harness {
  const saved: Message[][] = [];
  let screen = [...history];
  let active = true;
  const loading: boolean[] = [];
  const cleanedUp: AbortController[] = [];
  const traces: Harness["traces"] = { ended: [], scores: [] };

  const handler: TracingHandler = {
    traceStart: () => "trace_1",
    traceEnd: (_id, params) => { traces.ended.push(params); },
    generationStart: () => "gen", generationEnd: () => {},
    spanStart: () => "span", spanEnd: () => {},
    score: (_id, params) => { traces.scores.push({ value: params.value, comment: params.comment }); },
  };
  setTracingHandler(handler);

  const ui: ChatTurnUi = {
    messages: history,
    setMessages: update => { screen = typeof update === "function" ? update(screen) : update; },
    setIsLoading: value => { loading.push(value as boolean); },
    setStreamingContent: () => {},
    setStreamingThinking: () => {},
    abortControllerRef: { current: null },
    createStreamSession: () => ({
      mySessionId: 0,
      myChatId: "chat_1",
      isActive: () => active,
      saveResult: async msgs => { saved.push(msgs); if (active) screen = msgs; },
      cleanup: controller => { if (controller) cleanedUp.push(controller); },
    }),
    describeError: error => `failed: ${(error as Error).message}`,
  };

  return { ui, saved, onScreen: () => screen, loading, cleanedUp, detach: () => { active = false; }, traces };
}

describe("runChatTurn", () => {
  beforeEach(() => setTracingHandler(null));

  it("keeps the new chat's UI and controller when preparation finishes after a switch", async () => {
    const h = harness([user("old history")]);
    const foreground = new AbortController();
    h.ui.setStreamingContent = vi.fn();
    h.ui.setStreamingThinking = vi.fn();
    await runChatTurn(h.ui, {
      prepare: async () => {
        expect(h.ui.abortControllerRef.current).toBeInstanceOf(AbortController);
        h.detach();
        h.ui.setMessages([user("new chat")]);
        h.ui.abortControllerRef.current = foreground;
        return { userMessage: user("old prompt"), trace: { name: "chat" } };
      },
      run: async () => assistant("old answer"),
    });
    expect(h.onScreen()).toEqual([user("new chat")]);
    expect(h.loading).toEqual([]);
    expect(h.ui.setStreamingContent).not.toHaveBeenCalled();
    expect(h.ui.setStreamingThinking).not.toHaveBeenCalled();
    expect(h.ui.abortControllerRef.current).toBe(foreground);
    expect(h.saved).toEqual([[user("old history"), user("old prompt"), assistant("old answer")]]);
  });

  it("does not start a provider stopped during preparation", async () => {
    const h = harness();
    const run = vi.fn(async () => assistant("hi"));
    await runChatTurn(h.ui, {
      prepare: async () => {
        h.ui.abortControllerRef.current!.abort();
        return { userMessage: user("hello"), trace: { name: "chat" } };
      }, run,
    });
    expect(run).not.toHaveBeenCalled();
    expect(h.loading).toEqual([]);
    expect(h.cleanedUp).toHaveLength(1);
  });

  it("releases the session if preparation or teardown throws", async () => {
    for (const phase of ["prepare", "settle"]) {
      const h = harness();
      await expect(runChatTurn(h.ui, {
        prepare: () => {
          if (phase === "prepare") throw new Error("prepare");
          return { userMessage: user("hello"), trace: { name: "chat" } };
        },
        run: async () => assistant("hi"),
        onSettled: () => { throw new Error("settle"); },
      })).rejects.toThrow(phase);
      expect(h.cleanedUp).toHaveLength(1);
    }
  });

  it("shows the user's message, then saves it with the answer", async () => {
    const h = harness([user("earlier")]);
    await runChatTurn(h.ui, {
      prepare: () => ({ userMessage: user("hello"), trace: { name: "chat-message" } }),
      run: async () => assistant("hi"),
    });

    expect(h.saved).toEqual([[user("earlier"), user("hello"), assistant("hi")]]);
    expect(h.onScreen()).toEqual([user("earlier"), user("hello"), assistant("hi")]);
  });

  it("saves the user's message with the failure too", async () => {
    // A turn that throws after the user's message is on screen must not save a
    // history that has the answer but not the question.
    const h = harness([user("earlier")]);
    await runChatTurn(h.ui, {
      prepare: () => ({ userMessage: user("hello"), trace: { name: "chat-message" } }),
      run: async () => { throw new Error("no key"); },
    });

    expect(h.saved).toHaveLength(1);
    expect(h.saved[0].map(m => [m.role, m.content]))
      .toEqual([["user", "earlier"], ["user", "hello"], ["assistant", "failed: no key"]]);
    expect(h.traces.scores).toEqual([{ value: 0, comment: "failed: no key" }]);
  });

  it("leaves the chat alone when the attempt was abandoned", async () => {
    const h = harness([user("earlier")]);
    await runChatTurn(h.ui, {
      prepare: () => ({ userMessage: user("hello"), trace: { name: "chat-message" } }),
      run: async () => ({ message: null, status: { value: 0.5, comment: "aborted during retry" } }),
    });

    expect(h.saved).toEqual([]);
    expect(h.traces.scores).toEqual([{ value: 0.5, comment: "aborted during retry" }]);
  });

  it("releases the view however the turn ended", async () => {
    for (const run of [
      async () => assistant("hi"),
      async () => { throw new Error("x"); },
      async () => ({ message: null }),
    ]) {
      const h = harness();
      await runChatTurn(h.ui, { prepare: () => ({ userMessage: user("hello"), trace: { name: "chat-message" } }), run });
      expect(h.loading).toEqual([true]);
      expect(h.cleanedUp).toHaveLength(1);
      expect(h.ui.abortControllerRef.current).toBe(h.cleanedUp[0]);
    }
  });

  it("runs host teardown before the view is released, even on failure", async () => {
    const order: string[] = [];
    const h = harness();
    h.ui.createStreamSession = () => ({
      mySessionId: 0, myChatId: "chat_1", isActive: () => true,
      saveResult: async () => { order.push("save"); },
      cleanup: () => { order.push("cleanup"); },
    });

    await runChatTurn(h.ui, {
      prepare: () => ({ userMessage: user("hello"), trace: { name: "chat-message" } }),
      run: async () => { throw new Error("x"); },
      onSettled: () => order.push("teardown"),
    });

    expect(order).toEqual(["save", "teardown", "cleanup"]);
  });

  it("does not follow up in a chat the user has left", async () => {
    // The answer still reaches the chat it started in, but a request the edit
    // dialog collected must not be sent into whatever is on screen now.
    const h = harness();
    const followUps: string[] = [];
    h.detach();

    await runChatTurn(h.ui, {
      prepare: () => ({ userMessage: user("hello"), trace: { name: "chat-message" } }),
      run: async () => assistant("hi"),
      onSaved: () => followUps.push("sent"),
    });

    expect(h.saved).toHaveLength(1);
    expect(followUps).toEqual([]);
  });

  it("traces what the turn reported", async () => {
    const h = harness();
    await runChatTurn(h.ui, {
      prepare: () => ({ userMessage: user("hello"), trace: { name: "chat-message", input: "hello" } }),
      run: async () => ({
        message: assistant("hi"),
        output: "hi (stopped)",
        metadata: { stopped: true },
        status: { value: 0.5, comment: "stopped by user" },
      }),
    });

    expect(h.traces.ended).toEqual([{ output: "hi (stopped)", metadata: { stopped: true } }]);
    expect(h.traces.scores).toEqual([{ value: 0.5, comment: "stopped by user" }]);
  });

  it("opens the session before resolving what the user typed", async () => {
    // Switching chats during that await must not send the answer to whichever
    // chat the user opened next.
    const order: string[] = [];
    const h = harness();
    const create = h.ui.createStreamSession;
    h.ui.createStreamSession = () => { order.push("session"); return create(); };

    await runChatTurn(h.ui, {
      prepare: async () => { order.push("resolve"); return { userMessage: user("hello"), trace: { name: "chat-message" } }; },
      run: async () => assistant("hi"),
    });

    expect(order).toEqual(["session", "resolve"]);
  });

  it("calls the send off when there is nothing to send it with", async () => {
    const h = harness();
    await runChatTurn(h.ui, { prepare: () => null, run: async () => assistant("hi") });

    expect(h.saved).toEqual([]);
    expect(h.loading).toEqual([]);
    expect(h.onScreen()).toEqual([]);
  });

  it("hands what the preparation worked out to the rest of the turn", async () => {
    const h = harness();
    const seen: string[] = [];

    await runChatTurn<{ model: string }>(h.ui, {
      prepare: () => ({
        userMessage: user("hello"),
        trace: { name: "chat-message" },
        context: { model: "gemini-3-pro" },
      }),
      run: async (_turn, context) => { seen.push(`run:${context.model}`); return assistant("hi"); },
      onSaved: (_turn, context) => seen.push(`saved:${context.model}`),
      onSettled: (_turn, context) => seen.push(`settled:${context.model}`),
    });

    expect(seen).toEqual(["run:gemini-3-pro", "saved:gemini-3-pro", "settled:gemini-3-pro"]);
  });

  it("keeps the abort controller reachable to the stop button", async () => {
    const h = harness();
    let seen: AbortController | null = null;
    await runChatTurn(h.ui, {
      prepare: () => ({ userMessage: user("hello"), trace: { name: "chat-message" } }),
      run: async turn => {
        seen = h.ui.abortControllerRef.current;
        expect(turn.abortController).toBe(seen);
        return assistant("hi");
      },
    });
    expect(seen).not.toBeNull();
  });
});
