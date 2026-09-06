import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";

const state = vi.hoisted(() => ({
  pendingEdit: null as { originalPath: string; newContent: string; originalContent: string; createdAt: number } | null,
  applied: [] as string[],
  discarded: [] as string[],
  confirm: { action: "save" } as { action: string; additionalRequest?: string },
  confirmCalls: 0,
}));

vi.mock("../vault/notes.js", () => ({
  getPendingEdit: () => state.pendingEdit,
  getPendingDelete: () => null,
  getPendingRename: () => null,
  getPendingBulkEdit: () => null,
  getPendingBulkDelete: () => null,
  getPendingBulkRename: () => null,
  applyEdit: vi.fn(async () => { state.applied.push(state.pendingEdit!.originalPath); return { success: true }; }),
  discardEdit: vi.fn(() => { state.discarded.push(state.pendingEdit!.originalPath); }),
  applyDelete: vi.fn(), discardDelete: vi.fn(), applyRename: vi.fn(), discardRename: vi.fn(),
  applyBulkEdit: vi.fn(), discardBulkEdit: vi.fn(), applyBulkDelete: vi.fn(),
  discardBulkDelete: vi.fn(), applyBulkRename: vi.fn(), discardBulkRename: vi.fn(),
  getOpenFileAfterApplyPreference: () => false,
}));
vi.mock("../ui/workflow/EditConfirmationModal.js", () => ({
  promptForConfirmation: vi.fn(async () => { state.confirmCalls++; return state.confirm; }),
  promptForDeleteConfirmation: vi.fn(), promptForRenameConfirmation: vi.fn(),
  promptForBulkEditConfirmation: vi.fn(), promptForBulkDeleteConfirmation: vi.fn(),
  promptForBulkRenameConfirmation: vi.fn(),
}));

const { createConfirmingToolExecutor } = await import("./confirmingToolExecutor.js");

const app = {} as App;
const pending = (path: string, createdAt: number) =>
  ({ originalPath: path, newContent: "new", originalContent: "old", createdAt });

beforeEach(() => {
  state.pendingEdit = null;
  state.applied = [];
  state.discarded = [];
  state.confirm = { action: "save" };
  state.confirmCalls = 0;
});

describe("createConfirmingToolExecutor", () => {
  it("confirms and applies the edit this call created", async () => {
    const base = vi.fn(async () => { state.pendingEdit = pending("Notes/a.md", 1); return { success: true }; });
    const wrapper = createConfirmingToolExecutor(base, app, () => false, () => {});

    const result = await wrapper.executeToolCall("propose_edit", {});

    expect(result).toMatchObject({ applied: true });
    expect(state.applied).toEqual(["Notes/a.md"]);
    expect(wrapper.processedEdits).toEqual([{ originalPath: "Notes/a.md", status: "applied" }]);
  });

  it("ignores a pending edit this call did not create", async () => {
    // A leftover from an earlier call would otherwise be confirmed and applied
    // under the wrong tool call.
    state.pendingEdit = pending("Notes/stale.md", 1);
    const base = vi.fn(async () => ({ success: true }));
    const wrapper = createConfirmingToolExecutor(base, app, () => false, () => {});

    const result = await wrapper.executeToolCall("propose_edit", {});

    expect(state.confirmCalls).toBe(0);
    expect(state.applied).toEqual([]);
    expect(result).toEqual({ success: true });
  });

  it("does not confirm anything when the tool itself failed", async () => {
    const base = vi.fn(async () => { state.pendingEdit = pending("Notes/a.md", 2); return { success: false, error: "denied" }; });
    const wrapper = createConfirmingToolExecutor(base, app, () => false, () => {});

    await wrapper.executeToolCall("propose_edit", {});

    expect(state.confirmCalls).toBe(0);
    expect(state.applied).toEqual([]);
  });

  it("writes without asking when the send is allowed to", async () => {
    const base = vi.fn(async () => { state.pendingEdit = pending("Notes/a.md", 3); return { success: true }; });
    const wrapper = createConfirmingToolExecutor(base, app, () => true, () => {});

    await wrapper.executeToolCall("propose_edit", {});

    expect(state.confirmCalls).toBe(0);
    expect(state.applied).toEqual(["Notes/a.md"]);
  });

  it("stops the run once the user cancels, instead of asking again per call", async () => {
    state.confirm = { action: "cancel" };
    let cancelled = 0;
    let createdAt = 10;
    const base = vi.fn(async () => { state.pendingEdit = pending("Notes/a.md", createdAt++); return { success: true }; });
    const wrapper = createConfirmingToolExecutor(base, app, () => false, () => { cancelled++; });

    await wrapper.executeToolCall("propose_edit", {});
    const second = await wrapper.executeToolCall("propose_edit", {});

    expect(cancelled).toBe(1);
    expect(state.confirmCalls).toBe(1);
    expect(second).toEqual({ cancelled: true, message: "User cancelled the edit" });
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("passes the user's feedback back for the caller to send on", async () => {
    state.confirm = { action: "cancel", additionalRequest: "shorter please" };
    const base = vi.fn(async () => { state.pendingEdit = pending("Notes/a.md", 4); return { success: true }; });
    const wrapper = createConfirmingToolExecutor(base, app, () => false, () => {});

    const result = await wrapper.executeToolCall("propose_edit", {});

    expect(wrapper.pendingAdditionalRequest.current)
      .toEqual({ filePath: "Notes/a.md", request: "shorter please" });
    expect(result).toMatchObject({ applied: false, message: "User requested changes" });
    expect(state.discarded).toEqual(["Notes/a.md"]);
  });

  it("leaves a tool it does not confirm untouched", async () => {
    const base = vi.fn(async () => ({ success: true, content: "note text" }));
    const wrapper = createConfirmingToolExecutor(base, app, () => false, () => {});

    expect(await wrapper.executeToolCall("read_note", { fileName: "a.md" }))
      .toEqual({ success: true, content: "note text" });
  });
});
