import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React, { useState, createRef } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageList, MessageBubble, MessageContent, Composer, InputArea, CollapsedInput, HistoryList, Attachments, ModelSelector, filterModelOptions, VaultToolMenu, ChipSelector, VaultToolButton, McpServerToggles, EnabledMcpServers, InputButtons, SearchSelector, ModelDropdown, ModelRow, HistoryLimit, SourceBadges, ToolsUsed, SkillsUsed, VaultToolSection } from "../dist/index.js";
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

test("vault tool menu renders a description per mode and ignores disabled modes", () => {
  const chosen = [];
  const options = [
    { id: "all", label: "Vault: all", description: "Find, read and modify notes", selected: true },
    { id: "readOnly", label: "Vault: read only", description: "Search and read without writing" },
    { id: "none", label: "Vault: off", description: "Disable all built-in vault tools", disabled: true },
  ];
  const tree = render(h(VaultToolMenu, { classPrefix: "llm-hub", options, onSelect: id => chosen.push(id) },
    h("div", { className: "llm-hub-vault-tool-separator" })));
  const items = tree.root.findAll(node => node.props.className?.split(" ")[0] === "llm-hub-vault-tool-item");
  assert.deepEqual(items.map(item => item.props.className), [
    "llm-hub-vault-tool-item selected",
    "llm-hub-vault-tool-item",
    "llm-hub-vault-tool-item disabled",
  ]);
  const descriptions = tree.root.findAll(node => node.props.className === "llm-hub-vault-tool-item-desc");
  assert.deepEqual(descriptions.map(desc => desc.props.children), options.map(option => option.description));
  act(() => items[1].props.onClick());
  assert.equal(items[2].props.onClick, undefined);
  assert.deepEqual(chosen, ["readOnly"]);
  assert.equal(tree.root.findAll(node => node.props.className === "llm-hub-vault-tool-separator").length, 1);
  act(() => tree.unmount());
});

test("shared markup check reports host copies of library UI and honors the allowlist", async () => {
  const { findSharedMarkup, sharedStyledClasses } = await import("../scripts/check-markup.mjs");
  const dir = await mkdtemp(join(tmpdir(), "chat-ui-markup-"));
  try {
    await writeFile(join(dir, "Host.tsx"), [
      'const menu = <div className="llm-hub-vault-tool-menu" />;',
      'const own = <div className="llm-hub-host-only-thing" />;',
      'const btn = <button className="llm-hub-vault-tool-btn" />;',
    ].join("\n"));
    assert.ok((await sharedStyledClasses()).has("vault-tool-menu"));
    const findings = await findSharedMarkup({ dir, classPrefix: "llm-hub" });
    assert.deepEqual(findings.map(finding => [finding.className, finding.line]), [["llm-hub-vault-tool-menu", 1], ["llm-hub-vault-tool-btn", 3]]);
    const allowed = await findSharedMarkup({ dir, classPrefix: "llm-hub", allow: ["vault-tool-menu", "vault-tool-btn"] });
    assert.deepEqual(allowed, []);
    assert.deepEqual(await findSharedMarkup({ dir, classPrefix: "gemini-helper" }), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("chip selector shows active chips, links only openable ones and toggles from the chip", () => {
  const toggled = [];
  const opened = [];
  const choices = [
    { id: "skills/writing", name: "Writing", description: "Editing helpers", chipTitle: "Editing helpers", open: { title: "open Writing", onOpen: () => opened.push("Writing") } },
    { id: "builtin/search", name: "Search", description: "Bundled skill", chipTitle: "Bundled skill", badge: "built-in" },
  ];
  const ownerDocument = { addEventListener() {}, removeEventListener() {}, body: {} };
  const props = { classPrefix: "llm-hub", ownerDocument, icon: h("svg", null), addLabel: "add skill", choices, activeIds: ["skills/writing", "builtin/search"], onToggle: id => toggled.push(id) };
  const tree = render(h(ChipSelector, props));
  const chipNames = tree.root.findAll(node => node.props.className?.startsWith("llm-hub-skill-chip-name"));
  assert.deepEqual(chipNames.map(chip => chip.props.className), ["llm-hub-skill-chip-name llm-hub-tool-clickable", "llm-hub-skill-chip-name is-static"]);
  act(() => chipNames[0].props.onClick());
  assert.deepEqual(opened, ["Writing"]);
  assert.equal(chipNames[1].props.onClick, undefined);
  act(() => buttons(tree)[0].props.onClick());
  assert.deepEqual(toggled, ["skills/writing"]);
  assert.equal(buttons(tree).at(-1).props.title, "add skill");
  act(() => tree.update(h(ChipSelector, { ...props, activeIds: [] })));
  assert.equal(tree.root.findAll(node => node.props.className === "llm-hub-skill-chip").length, 0);
  act(() => tree.update(h(ChipSelector, { ...props, choices: [] })));
  assert.equal(tree.toJSON(), null);
  act(() => tree.update(h(ChipSelector, props)));
  assert.equal(tree.root.findAll(node => node.props.className === "llm-hub-skill-icon").length, 1);
  act(() => tree.unmount());
});

test("mcp controls list servers, disable in place and mute every toggle at once", () => {
  const toggled = [], disabled = [];
  const servers = [
    { id: "notes", name: "Notes", enabled: true, hint: "3 tools", toolsTitle: "read, write, list" },
    { id: "web", name: "Web", enabled: false, hint: "", toolsTitle: "" },
  ];
  const toggles = render(h(McpServerToggles, { classPrefix: "llm-hub", servers, onToggle: (id, enabled) => toggled.push([id, enabled]) }));
  const inputs = toggles.root.findAllByType("input");
  assert.deepEqual(inputs.map(input => input.props.checked), [true, false]);
  assert.equal(toggles.root.findAll(node => node.props.className === "llm-hub-mcp-tool-hint").length, 1);
  act(() => inputs[1].props.onChange({ target: { checked: true } }));
  assert.deepEqual(toggled, [["web", true]]);
  act(() => toggles.update(h(McpServerToggles, { classPrefix: "llm-hub", servers, onToggle() {}, disabled: true })));
  const muted = toggles.root.findAll(node => node.props.className?.startsWith("llm-hub-mcp-server-item"));
  assert.deepEqual(muted.map(item => item.props.className), ["llm-hub-mcp-server-item is-disabled", "llm-hub-mcp-server-item is-disabled"]);
  assert.deepEqual(toggles.root.findAllByType("input").map(input => input.props.checked), [false, false]);
  act(() => toggles.unmount());

  const chips = render(h(EnabledMcpServers, { classPrefix: "llm-hub", servers: [{ id: "notes", name: "Notes", title: "Notes is enabled", removeTitle: "disable Notes" }], onDisable: id => disabled.push(id) }));
  act(() => buttons(chips)[0].props.onClick());
  assert.deepEqual(disabled, ["notes"]);
  act(() => chips.update(h(EnabledMcpServers, { classPrefix: "llm-hub", servers: [], onDisable() {} })));
  assert.equal(chips.toJSON(), null);
  act(() => chips.unmount());
});

test("vault tool button marks a narrowed scope and holds the menu it opens", () => {
  let opened = 0;
  const props = { classPrefix: "llm-hub", title: "vault tools", active: false, containerRef: createRef(), onClick: () => opened++ };
  const tree = render(h(VaultToolButton, props, h("div", { className: "llm-hub-vault-tool-menu" })));
  assert.equal(buttons(tree)[0].props.className, "llm-hub-vault-tool-btn");
  act(() => buttons(tree)[0].props.onClick());
  assert.equal(opened, 1);
  act(() => tree.update(h(VaultToolButton, { ...props, active: true, disabled: true })));
  assert.equal(buttons(tree)[0].props.className, "llm-hub-vault-tool-btn active");
  assert.equal(buttons(tree)[0].props.disabled, true);
  assert.equal(tree.root.findAll(node => node.props.className === "llm-hub-vault-tool-menu").length, 0);
  act(() => tree.unmount());
});

test("attachment chips link only where the host provides a destination", () => {
  const opened = [], removed = [];
  const attachments = [
    { type: "pdf", name: "spec.pdf" },
    { type: "text", name: "note.md", open: { title: "view source", onOpen: () => opened.push("note.md") } },
  ];
  const tree = render(h(Attachments, { classPrefix: "llm-hub", attachments, pending: true, removeLabel: "remove", onRemove: index => removed.push(index) }));
  const chips = tree.root.findAll(node => node.props.className?.startsWith("llm-hub-pending-attachment") && node.type === "span");
  assert.deepEqual(chips.map(chip => chip.props.className), ["llm-hub-pending-attachment", "llm-hub-pending-attachment llm-hub-clickable"]);
  assert.equal(chips[0].props.onClick, undefined);
  act(() => chips[1].props.onClick());
  assert.deepEqual(opened, ["note.md"]);
  act(() => buttons(tree)[0].props.onClick({ stopPropagation() {} }));
  assert.deepEqual(removed, [0]);
  act(() => tree.unmount());
});

test("input buttons wire the paperclip to the hidden file input and keep host buttons beside it", () => {
  let picked = 0;
  const selected = [];
  const inputRef = createRef();
  const attach = { title: "attach", accept: ".md,.pdf", inputRef, onOpenPicker: () => picked++, onSelect: event => selected.push(event.target.files) };
  const tree = render(h(InputButtons, { classPrefix: "llm-hub", attach }, h("button", { title: "vault tools" })));
  const file = tree.root.findByType("input");
  assert.equal(file.props.className, "llm-hub-hidden-input");
  assert.equal(file.props.accept, ".md,.pdf");
  act(() => file.props.onChange({ target: { files: ["note.md"] } }));
  assert.deepEqual(selected, [["note.md"]]);
  assert.deepEqual(buttons(tree).map(button => button.props.title), ["attach", "vault tools"]);
  act(() => buttons(tree)[0].props.onClick());
  assert.equal(picked, 1);
  act(() => tree.update(h(InputButtons, { classPrefix: "llm-hub", attach: { ...attach, disabled: true } })));
  assert.equal(buttons(tree)[0].props.disabled, true);
  act(() => tree.unmount());
});

test("search selector summarises the active sources and drops web search for hosts without it", () => {
  const picked = [], webToggles = [];
  const ownerDocument = { addEventListener() {}, removeEventListener() {} };
  const labels = { webSearch: "Web search", rag: name => `RAG: ${name}`, ragNone: "RAG: none", none: "No search" };
  const props = {
    classPrefix: "llm-hub", ownerDocument, labels,
    webSearch: { checked: false, disabled: false, onChange: checked => webToggles.push(checked) },
    rag: { settings: ["notes", "papers"], selected: null, disabled: false, onSelect: name => picked.push(name) },
  };
  const tree = render(h(SearchSelector, props));
  const button = () => buttons(tree)[0];
  assert.equal(button().props.children[0], "No search");
  act(() => button().props.onClick());
  const options = tree.root.findAllByType("input");
  assert.deepEqual(options.map(input => input.props.type), ["checkbox", "radio", "radio", "radio"]);
  act(() => options[0].props.onChange({ target: { checked: true } }));
  assert.deepEqual(webToggles, [true]);
  act(() => options[3].props.onChange());
  assert.deepEqual(picked, ["papers"]);
  act(() => tree.update(h(SearchSelector, { ...props, webSearch: { ...props.webSearch, checked: true }, rag: { ...props.rag, selected: "papers" } })));
  assert.equal(button().props.children[0], "Web search + papers");
  act(() => tree.update(h(SearchSelector, { ...props, webSearch: undefined, rag: { ...props.rag, selected: "notes" } })));
  assert.equal(button().props.children[0], "RAG: notes");
  assert.deepEqual(tree.root.findAllByType("input").map(input => input.props.type), ["radio", "radio", "radio"]);
  act(() => tree.unmount());
});

test("model row wraps the picker and its dropdowns, labelling the row only when asked", () => {
  const chosen = [];
  const dropdown = h(ModelDropdown, { classPrefix: "llm-hub", value: "high", title: "Reasoning effort", className: "llm-hub-effort-select",
    options: [{ value: "low", label: "low" }, { value: "high", label: "high" }], onChange: value => chosen.push(value) });
  const tree = render(h(ModelRow, { classPrefix: "llm-hub" }, dropdown));
  const select = tree.root.findByType("select");
  assert.equal(select.props.className, "llm-hub-model-dropdown llm-hub-effort-select");
  assert.equal(select.props.value, "high");
  assert.deepEqual(select.props.children.map(option => option.props.value), ["low", "high"]);
  act(() => select.props.onChange({ target: { value: "low" } }));
  assert.deepEqual(chosen, ["low"]);
  assert.equal(tree.root.findAll(node => node.props.className === "llm-hub-model-label").length, 0);
  act(() => tree.update(h(ModelRow, { classPrefix: "llm-hub", label: "Model" }, dropdown)));
  assert.equal(tree.root.findAll(node => node.props.className === "llm-hub-model-label").length, 1);
  act(() => tree.unmount());
});

test("history limit offers every count up to the cap and reports numbers, not strings", () => {
  const chosen = [];
  const tree = render(h(HistoryLimit, { classPrefix: "llm-hub", label: "History", value: 4, max: 9, onChange: count => chosen.push(count) }));
  const select = tree.root.findByType("select");
  assert.equal(select.props.children.length, 10);
  assert.equal(select.props.value, 4);
  act(() => select.props.onChange({ target: { value: "7" } }));
  assert.deepEqual(chosen, [7]);
  assert.equal(tree.root.findAll(node => node.props.className === "llm-hub-vault-tool-separator").length, 1);
  act(() => tree.unmount());
});

test("message indicators open their sources and mark bundled skills as static", () => {
  const opened = [];
  const badges = render(h(SourceBadges, { classPrefix: "llm-hub", icon: "📚", label: "Semantic search",
    sources: [{ label: "📄 note", title: "notes/note.md", onOpen: () => opened.push("note") }] }));
  const source = badges.root.findByProps({ className: "llm-hub-rag-source llm-hub-tool-clickable" });
  act(() => source.props.onClick());
  assert.deepEqual(opened, ["note"]);
  act(() => badges.update(h(SourceBadges, { classPrefix: "llm-hub", icon: "🎨", label: "Image generated" })));
  assert.equal(badges.root.findAll(node => node.props.className === "llm-hub-rag-sources").length, 0);
  act(() => badges.unmount());

  const tools = render(h(ToolsUsed, { classPrefix: "llm-hub", errorHint: "a workflow failed" }, h("span", null, "read_note")));
  assert.equal(tools.root.findAll(node => node.props.className === "llm-hub-workflow-error-hint").length, 1);
  act(() => tools.update(h(ToolsUsed, { classPrefix: "llm-hub" }, h("span", null, "read_note"))));
  assert.equal(tools.root.findAll(node => node.props.className === "llm-hub-workflow-error-hint").length, 0);
  act(() => tools.unmount());

  const skills = render(h(SkillsUsed, { classPrefix: "llm-hub", label: "Skills", skills: [
    { name: "writing", title: "open writing", open: { onOpen: () => opened.push("writing") } },
    { name: "search", title: "search" },
  ] }));
  const chips = skills.root.findAll(node => node.props.className?.startsWith("llm-hub-skill-chip"));
  assert.deepEqual(chips.map(chip => chip.props.className), ["llm-hub-skill-chip llm-hub-tool-clickable", "llm-hub-skill-chip is-static"]);
  act(() => chips[0].props.onClick());
  assert.deepEqual(opened, ["note", "writing"]);
  assert.equal(chips[1].props.onClick, undefined);
  act(() => skills.unmount());
});

test("vault tool section titles the group it introduces", () => {
  const tree = render(h(VaultToolSection, { classPrefix: "llm-hub", label: "MCP servers" }, h("label", null, "Notes")));
  assert.equal(tree.root.findAll(node => node.props.className === "llm-hub-vault-tool-divider").length, 1);
  assert.equal(tree.root.findByProps({ className: "llm-hub-vault-tool-section-label" }).props.children, "MCP servers");
  act(() => tree.unmount());
});
