import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
import { WorkflowExecutor } from "./executor.js";
import { configureWorkflowHost, workflowHost, type WorkflowHost, type NodeRequest } from "./host.js";
import { parseWorkflowFromMarkdown, getNextNodes } from "./parser.js";
import { loadFromCodeBlock, saveToCodeBlock } from "./codeblockSync.js";
import { sidebarNodesToMermaid } from "./workflowToMermaid.js";
import { getWorkflowNodeSpec } from "./spec.js";
import { ExecutionHistoryManager } from "./history.js";

vi.mock("obsidian", async original => ({ ...await original<object>(), parseYaml: JSON.parse, stringifyYaml: (value: unknown) => JSON.stringify(value) }));
const block = (nodes: unknown[]) => '```hub-workflow\n' + JSON.stringify({ name: "Decision routing", nodes }) + '\n```';
const nodes = [
  { id: "judge", type: "decision", prompt: "Is this urgent?", input: "{{text}}", saveTo: "answer", trueNext: "urgent", falseNext: "normal" },
  { id: "urgent", type: "variable", name: "route", value: "urgent", next: "end" },
  { id: "normal", type: "variable", name: "route", value: "normal", next: "end" },
];
let previousHost: WorkflowHost;
beforeEach(() => {
  previousHost = workflowHost();
  vi.spyOn(ExecutionHistoryManager.prototype, "saveRecord").mockResolvedValue();
});
afterEach(() => { configureWorkflowHost(previousHost); vi.restoreAllMocks(); });

function run() {
  return new WorkflowExecutor({} as App).execute(parseWorkflowFromMarkdown(block(nodes)), { variables: new Map([["text", "Help now"]]) }, undefined,
    { recordHistory: true, workflowPath: "decision.md" });
}

describe("decision node branching", () => {
  it.each([true, false])("runs only the chosen branch and records the boolean result (%s)", async result => {
    configureWorkflowHost({ ...previousHost, runDecisionNode: async () => result });
    const execution = await run();
    expect(execution.context.variables.get("answer")).toBe(String(result));
    expect(execution.context.variables.get("route")).toBe(result ? "urgent" : "normal");
    expect(execution.historyRecord?.steps.map(step => step.nodeId)).toEqual(["judge", result ? "urgent" : "normal"]);
    expect(execution.historyRecord?.steps[0]).toMatchObject({ output: result, status: "success", input: { input: "Help now" } });
  });
  it.each([undefined, async () => { throw new Error("Decision service unavailable"); }, async () => "false" as unknown as boolean])(
    "stops on unsupported hosts, API failures, and malformed host results", async runDecisionNode => {
      configureWorkflowHost({ ...previousHost, runDecisionNode });
      await expect(run()).rejects.toThrow();
      const record = vi.mocked(ExecutionHistoryManager.prototype.saveRecord).mock.calls[0][0];
      expect(record).toMatchObject({ status: "error", errorNodeId: "judge" });
      expect(record.steps.some(step => step.nodeId !== "judge")).toBe(false);
    });
  it("does not take a branch when cancellation arrives during evaluation", async () => {
    const controller = new AbortController();
    let context!: NodeRequest["context"];
    configureWorkflowHost({ ...previousHost, runDecisionNode: async request => { context = request.context; controller.abort(); return false; } });
    await expect(new WorkflowExecutor({} as App).execute(parseWorkflowFromMarkdown(block(nodes)), { variables: new Map() }, undefined, { abortSignal: controller.signal })).rejects.toThrow();
    expect(context.variables.has("route")).toBe(false);
    expect(context.variables.has("answer")).toBe(false);
  });
  it("supports explicit end and the existing implicit false branch", async () => {
    const workflow = parseWorkflowFromMarkdown(block([{ ...nodes[0], trueNext: "end", falseNext: undefined }, ...nodes.slice(1)]));
    expect(getNextNodes(workflow, "judge", true)).toEqual([]);
    expect(getNextNodes(workflow, "judge", false)).toEqual(["urgent"]);
  });
  it("round-trips branch links through the editor serializer and renders both in Mermaid", async () => {
    const content = block(nodes);
    const loaded = loadFromCodeBlock(content).data!;
    const write = vi.fn();
    const file = new TFile(); file.path = "decision.md";
    const app = { vault: { read: async () => content, modify: write } } as unknown as App;
    await saveToCodeBlock(app, file, loaded);
    const reloaded = loadFromCodeBlock(write.mock.calls[0][1]).data!;
    expect(reloaded.nodes[0]).toMatchObject({ type: "decision", trueNext: "urgent", falseNext: "normal" });
    const mermaid = sidebarNodesToMermaid(reloaded.nodes);
    expect(mermaid).toContain('judge{"◇ DECISION');
    expect(mermaid).toContain('judge -->|"Yes"| urgent');
    expect(mermaid).toContain('judge -->|"No"| normal');
  });
  it("includes the decision node and its separate model options in AI workflow documentation", () => {
    const spec = getWorkflowNodeSpec(["decision"], { modelNames: ["chat-model"], decisionModelNames: ["jev"], mcpServers: [], ragSettingNames: [] });
    expect(spec).toContain("#### decision");
    expect(spec).toContain("Available: jev");
    expect(spec).toContain("gemini-decision-1");
    expect(spec).toContain("**trueNext**");
  });
});

describe("Score and Choice routes", () => {
  const criteria = ["None", "Low", "Useful", "Direct"];
  const scoreNodes = (threshold = "2") => [
    { ...nodes[0], decisionType: "score", criteria, threshold }, ...nodes.slice(1),
  ];
  it.each([[1.99, "normal"], [2, "urgent"], [2.7, "urgent"]] as const)("saves the raw score %s and takes %s", async (score, expected) => {
    configureWorkflowHost({ ...previousHost, runDecisionNode: async () => score });
    const result = await new WorkflowExecutor({} as App).execute(parseWorkflowFromMarkdown(block(scoreNodes("{{cutoff}}"))), { variables: new Map([["cutoff", "2"]]) });
    expect(result.context.variables.get("answer")).toBe(score);
    expect(result.context.variables.get("route")).toBe(expected);
  });
  it.each(["urgent", "normal", "ignore"])("follows the exact choice route %s including end", async selected => {
    configureWorkflowHost({ ...previousHost, runDecisionNode: async () => selected });
    const choices = { urgent: "Immediate", normal: "Later", ignore: "Not a request" };
    const workflow = parseWorkflowFromMarkdown(block([
      { ...nodes[0], decisionType: "choice", criteria: choices, branches: { urgent: "urgent", normal: "normal", ignore: "end" } },
      ...nodes.slice(1),
    ]));
    const result = await new WorkflowExecutor({} as App).execute(workflow, { variables: new Map() });
    expect(result.context.variables.get("answer")).toBe(selected);
    expect(result.context.variables.get("route")).toBe(selected === "ignore" ? undefined : selected);
  });
  it("keeps true and false choice labels as strings, rather than applying boolean coercion", async () => {
    configureWorkflowHost({ ...previousHost, runDecisionNode: async () => "false" });
    const workflow = parseWorkflowFromMarkdown(block([
      { ...nodes[0], decisionType: "choice", criteria: { true: "A", false: "B" }, branches: { true: "normal", false: "urgent" } }, ...nodes.slice(1),
    ]));
    const result = await new WorkflowExecutor({} as App).execute(workflow, { variables: new Map() });
    expect(result.context.variables.get("route")).toBe("urgent");
  });
  it.each([NaN, Infinity, -1, 4, "2"])("rejects invalid host scores without choosing a branch (%s)", async value => {
    configureWorkflowHost({ ...previousHost, runDecisionNode: async () => value });
    await expect(new WorkflowExecutor({} as App).execute(parseWorkflowFromMarkdown(block(scoreNodes())), { variables: new Map() })).rejects.toThrow("invalid or incomplete");
  });
  it("rejects a bad threshold and missing choice routes before calling the model", async () => {
    const handler = vi.fn(async () => 2);
    configureWorkflowHost({ ...previousHost, runDecisionNode: handler });
    await expect(new WorkflowExecutor({} as App).execute(parseWorkflowFromMarkdown(block(scoreNodes("NaN"))), { variables: new Map() })).rejects.toThrow("threshold");
    const workflow = parseWorkflowFromMarkdown(block([
      { ...nodes[0], decisionType: "choice", criteria: { urgent: "Now", normal: "Later" }, branches: { urgent: "urgent" } }, ...nodes.slice(1),
    ]));
    await expect(new WorkflowExecutor({} as App).execute(workflow, { variables: new Map() })).rejects.toThrow("every choice criterion");
    expect(handler).not.toHaveBeenCalled();
  });
  it("preserves criteria and routes when saving and shows every Choice label in Mermaid", async () => {
    const content = block([
      { ...nodes[0], decisionType: "choice", criteria: { urgent: "Now", normal: "Later", ignore: "Not needed" }, branches: { urgent: "urgent", normal: "normal", ignore: "end" } }, ...nodes.slice(1),
    ]);
    const loaded = loadFromCodeBlock(content).data!;
    const write = vi.fn(); const file = new TFile(); file.path = "choice.md";
    await saveToCodeBlock({ vault: { read: async () => content, modify: write } } as unknown as App, file, loaded);
    const reloaded = loadFromCodeBlock(write.mock.calls[0][1]).data!;
    expect(JSON.parse(reloaded.nodes[0].properties.branches)).toEqual({ urgent: "urgent", normal: "normal", ignore: "end" });
    expect(reloaded.nodes[0].trueNext).toBeUndefined();
    const mermaid = sidebarNodesToMermaid(reloaded.nodes);
    expect(mermaid).toContain('judge -->|"urgent"| urgent');
    expect(mermaid).toContain('judge -->|"normal"| normal');
    expect(mermaid).toContain('judge -->|"ignore"| FINISH');
    expect(parseWorkflowFromMarkdown(write.mock.calls[0][1]).edges.filter(edge => edge.from === "judge")).toHaveLength(2);
  });
  it("rejects nonexistent targets and illegal choice back references", () => {
    const choiceNode = { ...nodes[0], decisionType: "choice", criteria: { a: "A", b: "B" } };
    expect(() => parseWorkflowFromMarkdown(block([{ ...choiceNode, branches: { a: "missing", b: "end" } }]))).toThrow("Invalid edge");
    expect(() => parseWorkflowFromMarkdown(block([{ ...choiceNode, branches: { a: "judge", b: "end" } }]))).toThrow("back-reference");
  });
});

describe("batch decision workflow results", () => {
  const questions = {
    refund: { type: "noul", instructions: "Requests a refund" },
    request_type: { type: "choice", instructions: "Classify", criteria: { refund: "Refund", other: "Other" } },
    urgency: { type: "score", instructions: "Urgency", criteria: ["Low", "Medium", "High"] },
  };
  const batch = { id: "judge", type: "decision", decisionType: "batch", questions, input: "{{text}}", saveTo: "judgments", next: "check" };
  const workflowNodes = [batch,
    { id: "check", type: "if", condition: "{{judgments.urgency}} >= 1.5", trueNext: "urgent", falseNext: "normal" },
    { id: "urgent", type: "variable", name: "route", value: "{{judgments.request_type}}", next: "end" },
    { id: "normal", type: "variable", name: "route", value: "normal", next: "end" },
  ];
  it("saves named answers as JSON and lets a following if branch on their numeric and choice values", async () => {
    const handler = vi.fn(async () => ({ refund: 0.98, request_type: "refund", urgency: 1.8 }));
    configureWorkflowHost({ ...previousHost, runDecisionNode: handler });
    const result = await new WorkflowExecutor({} as App).execute(parseWorkflowFromMarkdown(block(workflowNodes)), { variables: new Map([["text", "Refund this today"]]) });
    expect(result.context.variables.get("judgments")).toBe('{"refund":0.98,"request_type":"refund","urgency":1.8}');
    expect(result.context.variables.get("route")).toBe("refund");
    expect(handler).toHaveBeenCalledOnce();
  });
  it("does not save partial results or run the next node when a requested answer is omitted", async () => {
    let context!: NodeRequest["context"];
    configureWorkflowHost({ ...previousHost, runDecisionNode: async request => { context = request.context; return { refund: 0.98 }; } });
    await expect(new WorkflowExecutor({} as App).execute(parseWorkflowFromMarkdown(block(workflowNodes)), { variables: new Map() })).rejects.toThrow("omitted");
    expect(context.variables.has("judgments")).toBe(false);
    expect(context.variables.has("route")).toBe(false);
  });
  it("requires a result variable before requesting a batch", async () => {
    const handler = vi.fn(async () => ({ refund: 0.98 }));
    configureWorkflowHost({ ...previousHost, runDecisionNode: handler });
    await expect(new WorkflowExecutor({} as App).execute(parseWorkflowFromMarkdown(block([{ ...batch, saveTo: "", next: "end" }])), { variables: new Map() })).rejects.toThrow("require saveTo");
    expect(handler).not.toHaveBeenCalled();
  });
  it("preserves question definitions and a normal next link when saved", async () => {
    const content = block(workflowNodes); const write = vi.fn(); const file = new TFile();
    await saveToCodeBlock({ vault: { read: async () => content, modify: write } } as unknown as App, file, loadFromCodeBlock(content).data!);
    const reloaded = loadFromCodeBlock(write.mock.calls[0][1]).data!;
    expect(JSON.parse(reloaded.nodes[0].properties.questions)).toEqual(questions);
    expect(reloaded.nodes[0].next).toBe("check");
    expect(parseWorkflowFromMarkdown(write.mock.calls[0][1]).edges[0]).toMatchObject({ from: "judge", to: "check", label: undefined });
    expect(sidebarNodesToMermaid(reloaded.nodes)).toContain("judge --> check");
  });
  it.each([[0.49, "normal"], [0.5, "urgent"], [0.99, "urgent"]] as const)("branches on Noul probability %s while saving the original value", async (probability, expected) => {
    configureWorkflowHost({ ...previousHost, runDecisionNode: async () => probability });
    const result = await new WorkflowExecutor({} as App).execute(parseWorkflowFromMarkdown(block([{ ...nodes[0], decisionType: "noul" }, ...nodes.slice(1)])), { variables: new Map() });
    expect(result.context.variables.get("answer")).toBe(probability);
    expect(result.context.variables.get("route")).toBe(expected);
  });
});
