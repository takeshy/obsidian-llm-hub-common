import test from "node:test";
import assert from "node:assert/strict";
import React, { useState } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { useChatStreamSessions } from "../dist/chat/useChatStreamSessions.js";

const h = React.createElement;

// Drives the hook from a component, and records every chat save it makes.
function harness({ onDetachStream, onLeaveIdle } = {}) {
  const api = {};
  const saved = [];
  const painted = [];
  function Host() {
    const [messages, setMessages] = useState([]);
    Object.assign(api, useChatStreamSessions({
      setMessages: (next) => { painted.push(next); setMessages(next); },
      saveChatToDisk: (msgs, chatId, opts) => { saved.push({ chatId, msgs, opts }); return Promise.resolve(); },
      currentChatId: "chat_1",
      onDetachStream,
      onLeaveIdle,
    }));
    return h("span", null, String(messages.length));
  }
  act(() => { TestRenderer.create(h(Host)); });
  return { api, saved, painted };
}

test("a stream that still owns the view paints and saves in the foreground", async () => {
  const { api, saved, painted } = harness();
  let session;
  act(() => { session = api.createStreamSession(); });
  assert.equal(session.myChatId, "chat_1");
  assert.equal(session.isActive(), true);

  await act(async () => { await session.saveResult([{ role: "user", content: "hi", timestamp: 1 }]); });
  assert.equal(painted.length, 1);
  assert.deepEqual(saved[0].opts, { session: undefined, foreground: true });
});

test("a detached stream saves to the chat it started in, without touching the view", async () => {
  const { api, saved, painted } = harness();
  let session;
  act(() => { session = api.createStreamSession(); });
  act(() => { api.leaveCurrentChat(); });
  assert.equal(session.isActive(), false);

  await act(async () => { await session.saveResult([{ role: "user", content: "hi", timestamp: 1 }]); });
  assert.equal(painted.length, 0, "the newly opened chat must not be overwritten");
  assert.equal(saved[0].chatId, "chat_1");
  assert.equal(saved[0].opts.foreground, undefined);
});

test("leaving a chat detaches a running stream and clears the view", () => {
  const detached = [];
  const idle = [];
  const { api } = harness({ onDetachStream: () => detached.push(1), onLeaveIdle: () => idle.push(1) });
  act(() => { api.setIsLoading(true); api.setStreamingContent("partial"); });
  act(() => { api.leaveCurrentChat(); });

  assert.deepEqual([detached.length, idle.length], [1, 0]);
  assert.equal(api.isLoading, false);
  assert.equal(api.streamingContent, "");
});

test("leaving an idle chat releases the host's resources instead", () => {
  const detached = [];
  const idle = [];
  const { api } = harness({ onDetachStream: () => detached.push(1), onLeaveIdle: () => idle.push(1) });
  act(() => { api.leaveCurrentChat(); });
  assert.deepEqual([detached.length, idle.length], [0, 1]);
});

test("only the foreground stream's cleanup clears the view", () => {
  const { api } = harness();
  let foreground;
  act(() => { foreground = api.createStreamSession(); });
  act(() => { api.setIsLoading(true); api.setStreamingThinking("thought"); });

  const detachedController = new AbortController();
  let background;
  act(() => { background = api.createStreamSession(); });
  act(() => { api.leaveCurrentChat(); });
  act(() => { api.setIsLoading(true); });

  act(() => { background.cleanup(detachedController); });
  assert.equal(api.isLoading, true, "a detached stream finishing must not stop the new one");

  act(() => { foreground.cleanup(null); });
  assert.equal(api.isLoading, true, "the first stream was detached too");
});

test("the oldest background stream is aborted once the cap is passed", () => {
  const { api } = harness();
  const controllers = [];
  for (let i = 0; i < 5; i++) {
    const controller = new AbortController();
    controllers.push(controller);
    act(() => {
      api.abortControllerRef.current = controller;
      api.setIsLoading(true);
      api.leaveCurrentChat();
    });
  }
  // Three may keep running; the two oldest were aborted to make room.
  assert.deepEqual(controllers.map(c => c.signal.aborted), [true, true, false, false, false]);
});

test("the stop button aborts only the foreground stream", () => {
  const { api } = harness();
  const controller = new AbortController();
  act(() => { api.abortControllerRef.current = controller; });
  act(() => { api.abortActiveStream(); });
  assert.equal(controller.signal.aborted, true);
});
