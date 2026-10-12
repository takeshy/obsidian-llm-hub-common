import { describe, expect, it } from "vitest";
import type { LoadedSkill } from "../skills/skillsLoader.js";
import { dashboardBasePrompt, dashboardRewritePrompt, dashboardWorkflowPrompt, stripYamlFence } from "./prompts.js";
import { extractWorkflowOutput } from "./workflowRunner.js";
import { assertTimelineAnswerSupported, timelineAnswerMessages, timelineAnswerSystemPrompt } from "./timelineAnswer.js";

const question = "@ai What changed?";

describe("Timeline answers", () => {
  it("keeps thread roles and ends on the question", () => {
    const messages = timelineAnswerMessages({ question, messages: [{ role: "user", content: question }, { role: "assistant", content: "Earlier" }] }, 1);
    expect(messages.map(message => message.role)).toEqual(["user", "assistant", "user"]);
    expect(messages[2]).toEqual({ role: "user", content: `Answer this post from the thread:\n\n${question}`, timestamp: 1 });
    expect(timelineAnswerMessages({ question, messages: [{ role: "user", content: question }] }, 1)).toHaveLength(1);
  });

  it("describes only the lookups that are offered, with the Hub's instructions last", () => {
    const bare = timelineAnswerSystemPrompt({});
    expect(bare).toContain("@ai");
    expect(bare).not.toMatch(/Vault tools|MCP tools|Additional instructions/);
    const full = timelineAnswerSystemPrompt({ vaultRead: true, ragContext: "RAG CONTEXT", mcp: true, skillPrompt: "\n\nSKILLS", additionalInstructions: "Be brief" });
    expect(full).toContain("Read-only Vault tools");
    expect(full).toContain("\nRAG CONTEXT");
    expect(full).toContain("MCP tools");
    expect(full.endsWith("Additional instructions: Be brief")).toBe(true);
    expect(full.indexOf("SKILLS")).toBeLessThan(full.indexOf("Additional instructions"));
  });

  it("rejects web search the model cannot do and web search combined with RAG", () => {
    const request = { modelId: "m", messages: [], question };
    expect(() => assertTimelineAnswerSupported({ ...request, webSearch: true }, { webSearch: false })).toThrow("not available");
    expect(() => assertTimelineAnswerSupported({ ...request, webSearch: true, ragSetting: "Notes" }, { webSearch: true })).toThrow("same time");
    expect(() => assertTimelineAnswerSupported({ ...request, webSearch: true }, { webSearch: true })).not.toThrow();
  });
});

describe("Dashboard generation prompts", () => {
  it("revises the previous result before the current source", () => {
    const base = { modelId: "m", instruction: "Add a column", allowVaultRead: false };
    expect(dashboardBasePrompt({ ...base, currentYaml: "old", previousResult: "new" }, null).prompt).toContain("Current YAML:\nnew");
    expect(dashboardBasePrompt(base, null).prompt).toContain("Create an Obsidian Base");
    const skill = { instructions: "BASES SKILL", references: ["REF"] } as LoadedSkill;
    expect(dashboardBasePrompt(base, skill).systemPrompt).toContain("BASES SKILL\n\nREF");
    expect(dashboardRewritePrompt({ modelId: "m", content: "a", instruction: "i", context: "memo", previousResult: "b" }))
      .toEqual(expect.objectContaining({ prompt: expect.stringContaining("Text to rewrite:\nb"), systemPrompt: expect.stringContaining("memo") }));
    const workflow = dashboardWorkflowPrompt({ modelId: "m", mode: "modify", instruction: "i", currentMarkdown: "WF", allowVaultRead: false,
      outputContract: { outputVariable: "out", format: "html" } }, "SPEC");
    expect(workflow.prompt).toMatch(/^Revise [\s\S]*html in variable out[\s\S]*Current workflow:\nWF$/);
    expect(workflow.systemPrompt).toContain("SPEC");
  });

  it("strips a YAML fence", () => {
    expect(stripYamlFence("```yaml\nviews: []\n```")).toBe("views: []");
  });
});

describe("Dashboard workflow output", () => {
  it("prefers the named variable, then result, then the first public string", () => {
    const values = new Map<string, string | number>([["_internal", "x"], ["count", 3], ["result", "R"]]);
    expect(extractWorkflowOutput(values, "count")).toBe("3");
    expect(extractWorkflowOutput(values)).toBe("R");
    values.delete("result");
    expect(extractWorkflowOutput(values)).toBe("3");
    expect(extractWorkflowOutput(values, "missing")).toBeNull();
  });
});
