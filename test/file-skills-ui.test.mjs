import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Welcome, MessageList } from "../dist/index.js";
import { t, setLocale } from "../dist/i18n/index.js";

const h = React.createElement;
const welcomeProps = {
  classPrefix: "llm-hub", title: "Welcome", hint: "Start a chat",
  dashboard: { title: "Dashboard", description: "Open a dashboard", openLabel: "Open", createLabel: "Create" },
  help: { title: "Help", description: "Get help", label: "Ask" },
  tips: [],
};

test("file skills are suggested and enabled only by an explicit click", () => {
  setLocale("ja");
  let enabled = 0;
  const fileSkill = { fileName: "Note.md", kind: "markdown", skillName: "Obsidian Markdown", enabled: false, onEnable: () => enabled++ };
  let tree;
  act(() => { tree = TestRenderer.create(h(Welcome, { ...welcomeProps, fileSkill })); });
  assert.equal(enabled, 0);
  assert.match(JSON.stringify(tree.toJSON()), /Note.md/);
  const skillButton = () => tree.root.findAllByType("button").find(button => button.findAllByType("span").some(span => span.children.join("") === t(fileSkill.enabled ? "welcome.fileSkill.enabled" : "welcome.fileSkill.enable", { skill: fileSkill.skillName })));
  assert.equal(skillButton().props.disabled, false);
  act(() => skillButton().props.onClick());
  assert.equal(enabled, 1);
  fileSkill.enabled = true;
  act(() => tree.update(h(Welcome, { ...welcomeProps, fileSkill })));
  assert.equal(skillButton().props.disabled, true);
  assert.equal(enabled, 1);
  act(() => tree.update(h(Welcome, welcomeProps)));
  assert.doesNotMatch(JSON.stringify(tree.toJSON()), /Obsidian Markdown/);
  act(() => tree.unmount());
  setLocale("en");
});

test("the skill suggestion appears only in an empty chat", () => {
  const fileSkill = { fileName: "Board.canvas", kind: "canvas", skillName: "JSON Canvas", enabled: false, onEnable() {} };
  const props = {
    classPrefix: "llm-hub", messages: [], streamingContent: "", streamingThinking: "", isLoading: false,
    emptyState: h(Welcome, { ...welcomeProps, fileSkill }),
    renderMessage: message => h("p", null, message.content), renderStreamingMessage: () => h("p", null, "streaming"),
  };
  let tree;
  act(() => { tree = TestRenderer.create(h(MessageList, props)); });
  assert.match(JSON.stringify(tree.toJSON()), /Board.canvas/);
  act(() => tree.update(h(MessageList, { ...props, messages: [{ role: "user", content: "Hello" }] })));
  assert.doesNotMatch(JSON.stringify(tree.toJSON()), /Board.canvas/);
  act(() => tree.update(h(MessageList, { ...props, isLoading: true, streamingContent: "Reply" })));
  assert.doesNotMatch(JSON.stringify(tree.toJSON()), /Board.canvas/);
  act(() => tree.unmount());
});
