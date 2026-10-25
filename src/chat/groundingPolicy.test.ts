import { describe, expect, it } from "vitest";
import { GroundingChatPolicies } from "./groundingPolicy.js";
import { messagesToMarkdown, parseMarkdownToMessages, messagesToCompactMarkdown } from "./chatHistory.js";
import type { Message } from "../core/message.js";

describe("Grounding conversation persistence", () => {
  it("never re-enables automatic saving in an existing session, while a new chat starts normally", () => {
    const policy = new GroundingChatPolicies();
    expect(policy.canAutoSave("one")).toBe(true);
    policy.restrict("one");
    policy.restore("one", { autoSaveDisabledByGrounding: false });
    expect(policy.canAutoSave("one")).toBe(false);
    expect(policy.get(null).autoSaveDisabledByGrounding).toBe(false);
    expect(policy.canAutoSave("two")).toBe(true);
    const restored = new GroundingChatPolicies(id => id === "one");
    expect(restored.canAutoSave("one")).toBe(false);
  });
  it("manual serialization keeps all visible turns and the policy, stripping Google and opaque metadata", async () => {
    const messages: Message[] = [
      { role: "user", content: "original question", timestamp: 1 },
      { role: "assistant", content: "visible grounded answer", timestamp: 2, googleSearchGrounding: true,
        webSearchSources: [{ title: "secret source", url: "https://do-not-save.test" }],
        searchSuggestions: ["<style>display-only-html</style>"],
        toolResults: [{ toolCallId: "one", result: { groundingMetadata: { searchEntryPoint: { renderedContent: "raw-search-data" } } } }],
        providerContinuation: { provider: "openai", baseUrl: "https://provider.test", model: "m", items: [{ secret: "opaque-data" }] },
        interactionId: "private-server-id", llmContent: "hidden-original-input", thinking: "not-for-export" },
      { role: "user", content: "later follow up", timestamp: 3 },
    ];
    const markdown = await messagesToMarkdown(messages, "Manual save", 1, undefined, undefined, { autoSaveDisabledByGrounding: true });
    for (const text of ["original question", "visible grounded answer", "later follow up"]) expect(markdown).toContain(text);
    for (const text of ["webSearchSources", "do-not-save", "searchEntryPoint", "renderedContent", "groundingMetadata", "toolResults", "providerContinuation", "opaque-data", "display-only-html", "private-server-id", "hidden-original-input", "not-for-export"]) expect(markdown).not.toContain(text);
    const parsed = parseMarkdownToMessages(markdown);
    expect(parsed?.autoSaveDisabledByGrounding).toBe(true);
    expect(parsed?.messages.map(message => message.content)).toEqual(messages.map(message => message.content));
    expect(messagesToCompactMarkdown(messages, { autoSaveDisabledByGrounding: true })).toContain("autoSaveDisabledByGrounding: true");
  });
  it("also protects a native Google message when a caller omits the session option", async () => {
    const md = await messagesToMarkdown([{ role: "assistant", content: "answer", timestamp: 1, googleSearchGrounding: true,
      searchSuggestions: ["must-not-persist"], webSearchSources: [{ title: "hidden", url: "https://hidden.test" }] }], "title", 1, undefined);
    expect(md).not.toContain("must-not-persist"); expect(md).not.toContain("hidden.test");
    expect(parseMarkdownToMessages(md)?.autoSaveDisabledByGrounding).toBe(true);
  });
});
