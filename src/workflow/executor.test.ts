import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { WorkflowExecutor } from "./executor.js";
import { configureWorkflowHost, workflowHost, type NodeRequest, type WorkflowHost } from "./host.js";
import { ExecutionHistoryManager } from "./history.js";
import type { ExecutionLog, WorkflowNode } from "./types.js";

describe("rag-sync execution", () => {
  let previousHost: WorkflowHost;
  const app = {} as App;
  const node: WorkflowNode = {
    id: "sync", type: "rag-sync", canvasNodeId: "sync",
    properties: { ragSetting: "notes", saveTo: "result" },
  };

  beforeEach(() => {
    previousHost = workflowHost();
    configureWorkflowHost({ ...previousHost, runRagSyncNode: undefined });
  });

  afterEach(() => {
    configureWorkflowHost(previousHost);
    vi.restoreAllMocks();
  });

  function run(logs: ExecutionLog[], abortSignal?: AbortSignal) {
    return new WorkflowExecutor(app).execute(
      { nodes: new Map([[node.id, node]]), edges: [], startNode: node.id },
      { variables: new Map() },
      log => logs.push(log),
      { workflowPath: "sync.md", recordHistory: true, abortSignal },
    );
  }

  it("rejects unsupported RAG sync and records an error instead of success", async () => {
    const save = vi.spyOn(ExecutionHistoryManager.prototype, "saveRecord").mockResolvedValue();
    const logs: ExecutionLog[] = [];

    await expect(run(logs)).rejects.toThrow("rag-sync requires the workflow host to implement runRagSyncNode");

    expect(logs.some(log => log.nodeId === "sync" && log.status === "error")).toBe(true);
    expect(logs.some(log => log.status === "success")).toBe(false);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      status: "error",
      errorNodeId: "sync",
      steps: [expect.objectContaining({ nodeId: "sync", status: "error" })],
    }));
  });

  it("waits for the registered host and preserves its result and abort signal", async () => {
    vi.spyOn(ExecutionHistoryManager.prototype, "saveRecord").mockResolvedValue();
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const handler = vi.fn(async ({ context }: NodeRequest) => {
      await pending;
      context.variables.set("result", '{"indexedFiles":3}');
    });
    configureWorkflowHost({ ...workflowHost(), runRagSyncNode: handler });
    const logs: ExecutionLog[] = [];
    const controller = new AbortController();
    const execution = run(logs, controller.signal);

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ node, app, abortSignal: controller.signal }));
    expect(logs.some(log => log.status === "success")).toBe(false);
    finish();
    const result = await execution;

    expect(result.context.variables.get("result")).toBe('{"indexedFiles":3}');
    expect(result.historyRecord).toMatchObject({
      status: "completed",
      steps: [expect.objectContaining({ nodeId: "sync", status: "success", output: '{"indexedFiles":3}' })],
    });
  });

  it("propagates host sync failures without recording success", async () => {
    const save = vi.spyOn(ExecutionHistoryManager.prototype, "saveRecord").mockResolvedValue();
    const failure = new Error("Embedding server unavailable");
    configureWorkflowHost({
      ...workflowHost(),
      runRagSyncNode: vi.fn().mockRejectedValue(failure),
    });
    const logs: ExecutionLog[] = [];

    await expect(run(logs)).rejects.toBe(failure);

    expect(logs.some(log => log.status === "success")).toBe(false);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ status: "error" }));
  });
});
