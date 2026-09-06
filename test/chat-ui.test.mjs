import test from "node:test";
import assert from "node:assert/strict";
import React, { useState, createRef } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageList, MessageBubble, MessageContent, Composer, InputArea, CollapsedInput, HistoryList, Attachments, ModelSelector, filterModelOptions } from "../dist/index.js";
const h = React.createElement;
const render = element => { let tree; act(() => { tree = TestRenderer.create(element); }); return tree; };
const buttons = tree => tree.root.findAllByType("button");
const baseComposer = { classPrefix: "gemini-helper", textareaRef: createRef(), textarea: { value: "draft", onChange() {} }, canSend: true, isLoading: false, onSend() {}, sendLabel: "send", stopLabel: "stop" };

test("mobile Gemini collapse and expand retain draft and attachments", () => {
  function MobileChat() {
    const [collapsed, setCollapsed] = useState(false);
    const [draft, setDraft] = useState("unsent draft");
    return h(InputArea, {
      classPrefix: "gemini-helper", collapsed,
      beforeInput: !collapsed && h(Attachments, { classPrefix: "gemini-helper", attachments: [{ type: "pdf", name: "note.pdf" }], pending: true }),
      composer: h(Composer, { ...baseComposer, textarea: { value: draft, onChange: e => setDraft(e.target.value) }, collapse: { collapsed, label: "collapse", onToggle: () => setCollapsed(true) } }),
      footer: collapsed && h(CollapsedInput, { classPrefix: "gemini-helper", label: "expand", onExpand: () => setCollapsed(false) }),
    });
  }
  const tree = render(h(MobileChat));
  act(() => tree.root.findByType("textarea").props.onChange({ target: { value: "edited draft" } }));
  act(() => buttons(tree).find(button => button.props.title === "collapse").props.onClick());
  assert.equal(tree.root.findAllByType("textarea").length, 0);
  assert.deepEqual(buttons(tree).map(button => button.props.title), ["expand"]);
  act(() => buttons(tree)[0].props.onClick());
  assert.equal(tree.root.findByType("textarea").props.value, "edited draft");
  assert.match(JSON.stringify(tree.toJSON()), /note.pdf/);
  act(() => tree.unmount());
});

test("composer switches send, stop and compacting without a mobile toggle by default", () => {
  let sent = 0, stopped = 0;
  const props = { ...baseComposer, onSend: () => sent++, onStop: () => stopped++ };
  const tree = render(h(Composer, props));
  act(() => buttons(tree)[0].props.onClick());
  assert.equal(sent, 1);
  act(() => tree.update(h(Composer, { ...props, isLoading: true })));
  assert.equal(buttons(tree)[0].props.title, "stop");
  act(() => buttons(tree)[0].props.onClick());
  assert.equal(stopped, 1);
  act(() => tree.update(h(Composer, { ...props, isCompacting: true, compactingLabel: "compacting" })));
  assert.equal(buttons(tree).length, 1);
  assert.equal(buttons(tree)[0].props.disabled, true);
  act(() => tree.update(h(Composer, { ...props, canSend: false })));
  assert.equal(buttons(tree)[0].props.disabled, true);
  act(() => tree.unmount());
});

test("IME and keyboard events reach the host composer unchanged", () => {
  const seen = [];
  const tree = render(h(Composer, { ...baseComposer, textarea: { ...baseComposer.textarea, onKeyDown: event => seen.push(event) } }));
  const event = { key: "Enter", nativeEvent: { isComposing: true } };
  tree.root.findByType("textarea").props.onKeyDown(event);
  assert.equal(seen[0], event);
  act(() => tree.unmount());
});

test("list preserves message metadata, source association and streaming thinking", () => {
  const messages = [{ role: "user", content: 'From "folder/source.md": hello', timestamp: 1 }, { role: "assistant", content: "reply", timestamp: 2, extra: "provider-state" }, { role: "user", content: "next", timestamp: 3 }, { role: "assistant", content: "reply2", timestamp: 4 }];
  const seen = [], streamed = [];
  const props = { classPrefix: "llm-hub", messages, streamingContent: "", streamingThinking: "reasoning", isLoading: true, renderMessage: (message, index, source) => { seen.push([message, index, source]); return h("p", null, message.content); }, renderStreamingMessage: message => { streamed.push(message); return h("p", null, message.thinking); } };
  const html = renderToStaticMarkup(h(MessageList, props));
  assert.equal(seen[1][0], messages[1]);
  assert.equal(seen[1][2], "source");
  assert.equal(seen[3][2], null);
  assert.equal(streamed[0].role, "assistant");
  assert.equal(streamed[0].thinking, "reasoning");
  assert.doesNotMatch(html, /loading-dot/);
  assert.match(renderToStaticMarkup(h(MessageList, { ...props, streamingThinking: "" })), /loading-dot/);
});

test("copy is hidden during streaming, thinking stays open while generating", () => {
  const props = { classPrefix: "llm-hub", isUser: false, roleLabel: "model", timeLabel: "12:00", copied: false, copyLabel: "copy", onCopy() {} };
  const content = h(MessageContent, { classPrefix: "llm-hub", contentRef: createRef(), thinking: "reasoning", thinkingLabel: "thinking", thinkingOpen: true });
  const html = renderToStaticMarkup(h(MessageBubble, { ...props, isStreaming: true }, content));
  assert.doesNotMatch(html, /copy-btn/);
  assert.match(html, /<details[^>]*open=""/);
  assert.match(renderToStaticMarkup(h(MessageBubble, props, content)), /copy-btn/);
});

test("history deletion stops propagation and keeps encrypted entry adapter data", () => {
  const events = [];
  const entry = { id: "id", title: "encrypted", dateLabel: "today", encrypted: true, providerSession: "keep" };
  const tree = render(h(HistoryList, { classPrefix: "llm-hub", entries: [entry], currentId: "id", emptyLabel: "empty", deleteLabel: "delete", onSelect: value => events.push(["select", value]), onDelete: value => events.push(["delete", value]), renderExtra: () => h("input", { type: "password" }), panel: true }));
  buttons(tree)[0].props.onClick({ stopPropagation: () => events.push("stop") });
  assert.deepEqual(events, ["stop", ["delete", entry]]);
  assert.equal(tree.root.findByType("input").props.type, "password");
  act(() => tree.unmount());
});

test("model search supports labels and providers; composing Enter never selects", () => {
  const models = [{ value: "a", label: "Alpha", keywords: "provider-one" }, { value: "b", label: "Beta" }, { value: "a", label: "duplicate" }];
  assert.deepEqual(filterModelOptions(models, " PROVIDER-one "), [models[0]]);
  assert.deepEqual(filterModelOptions(models, "beta"), [models[1]]);
  assert.equal(filterModelOptions(models, "").length, 2);
  const selected = [];
  const tree = render(h(ModelSelector, { classPrefix: "llm-hub", models, value: "a", onChange: value => selected.push(value), filterLabel: "filter", emptyLabel: "empty" }));
  act(() => buttons(tree)[0].props.onClick());
  const input = tree.root.findByType("input");
  act(() => input.props.onChange({ target: { value: "Beta" } }));
  act(() => input.props.onKeyDown({ key: "Enter", nativeEvent: { isComposing: true } }));
  assert.equal(selected.length, 0);
  act(() => input.props.onKeyDown({ key: "Enter", nativeEvent: { isComposing: false }, preventDefault() {} }));
  assert.deepEqual(selected, ["b"]);
  assert.equal(tree.root.findAllByType("input").length, 0);
  act(() => tree.unmount());
});
