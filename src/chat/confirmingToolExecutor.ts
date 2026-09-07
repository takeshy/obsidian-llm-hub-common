import type { App } from "obsidian";
import type { PendingDeleteInfo, PendingEditInfo, PendingRenameInfo } from "../core/message.js";
import {
  applyBulkDelete,
  applyBulkEdit,
  applyBulkRename,
  applyDelete,
  applyEdit,
  applyRename,
  discardBulkDelete,
  discardBulkEdit,
  discardBulkRename,
  discardDelete,
  discardEdit,
  discardRename,
  getOpenFileAfterApplyPreference,
  getPendingBulkDelete,
  getPendingBulkEdit,
  getPendingBulkRename,
  getPendingDelete,
  getPendingEdit,
  getPendingRename,
} from "../vault/notes.js";
import {
  promptForBulkDeleteConfirmation,
  promptForBulkEditConfirmation,
  promptForBulkRenameConfirmation,
  promptForConfirmation,
  promptForDeleteConfirmation,
  promptForRenameConfirmation,
} from "../ui/workflow/EditConfirmationModal.js";

/** A tool that reports an error, or reports that it did not succeed, changed nothing. */
function didToolCallFail(result: Record<string, unknown>): boolean {
  return result.error !== undefined || result.success === false;
}

export interface ConfirmingToolExecutor {
  executeToolCall: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** What was applied, discarded or failed, for the badges on the finished message. */
  processedEdits: PendingEditInfo[];
  processedDeletes: PendingDeleteInfo[];
  processedRenames: PendingRenameInfo[];
  /** Feedback from "Request changes"; the caller sends it back as a follow-up. */
  pendingAdditionalRequest: { current: { filePath: string; request: string } | null };
}

/**
 * Wrap a base tool executor to handle the propose_edit / propose_delete /
 * rename_note / bulk_* tools — these need synchronous user confirmation in
 * the chat UI before the change applies. The wrapper:
 *   - Detects newly created pending edits/deletes/renames after each call
 *   - Drives the appropriate confirmation modal
 *   - Applies or discards based on the user's choice
 *   - Records the disposition in processedEdits/Deletes/Renames so the
 *     final assistant message can show inline status badges
 *
 * Used by both the API provider chat path and the Local-LLM-with-tools
 * path so behaviour stays identical between providers.
 */
export function createConfirmingToolExecutor(
  baseExecuteToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  app: App,
  /** Whether this send may write without asking, e.g. a slash command with confirmEdits off. */
  autoApply: () => boolean,
  /** Stop the run once the user cancels an edit, rather than asking again per call. */
  cancelGeneration: () => void,
): ConfirmingToolExecutor {
  const processedEdits: PendingEditInfo[] = [];
  const processedDeletes: PendingDeleteInfo[] = [];
  const processedRenames: PendingRenameInfo[] = [];
  // Feedback from "Request changes" in the edit confirmation modal. The caller
  // hands it to setPendingEditFeedback once the stream is done, which sends it
  // back to the model as a follow-up message.
  const pendingAdditionalRequest: { current: { filePath: string; request: string } | null } = { current: null };
  let cancelled = false;
  const superseded = () => ({
    success: false,
    error: "The proposal changed while awaiting confirmation. Please propose the change again.",
  });

  const executeToolCall = async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
    if (cancelled) return { cancelled: true, message: "User cancelled the edit" };
    const prevPendingEdit = getPendingEdit();
    const prevPendingDelete = getPendingDelete();
    const prevPendingRename = getPendingRename();
    const prevPendingBulkEdit = getPendingBulkEdit();
    const prevPendingBulkDelete = getPendingBulkDelete();
    const prevPendingBulkRename = getPendingBulkRename();
    const result = await baseExecuteToolCall(name, args) as Record<string, unknown>;
    const toolCallFailed = didToolCallFail(result);

    if (name === "propose_edit") {
      const pending = getPendingEdit();
      const hasNewPending = pending && pending !== prevPendingEdit;
      if (hasNewPending && !toolCallFailed) {
        if (autoApply()) {
          const applyResult = await applyEdit(app);
          if (applyResult.success) {
            processedEdits.push({ originalPath: pending.originalPath, status: "applied" });
            return { ...result, applied: true, message: `Applied changes to "${pending.originalPath}"` };
          }
          if (getPendingEdit() === pending) discardEdit(app);
          processedEdits.push({ originalPath: pending.originalPath, status: "failed" });
          return { ...result, applied: false, error: applyResult.error };
        }

        const confirmResult = await promptForConfirmation(
          app, pending.originalPath, pending.newContent, "overwrite", pending.originalContent,
        );
        if (getPendingEdit() !== pending) return superseded();
        if (confirmResult.action === "save") {
          const applyResult = await applyEdit(app, { openFile: getOpenFileAfterApplyPreference(app) });
          if (applyResult.success) {
            processedEdits.push({ originalPath: pending.originalPath, status: "applied" });
            return { ...result, applied: true, message: `Applied changes to "${pending.originalPath}"` };
          }
          if (getPendingEdit() === pending) discardEdit(app);
          processedEdits.push({ originalPath: pending.originalPath, status: "failed" });
          return { ...result, applied: false, error: applyResult.error };
        }
        if (confirmResult.additionalRequest !== undefined) {
          if (getPendingEdit() === pending) discardEdit(app);
          processedEdits.push({ originalPath: pending.originalPath, status: "discarded" });
          pendingAdditionalRequest.current = {
            filePath: pending.originalPath,
            request: confirmResult.additionalRequest,
          };
          return { ...result, applied: false, message: "User requested changes" };
        }
        if (getPendingEdit() === pending) discardEdit(app);
        processedEdits.push({ originalPath: pending.originalPath, status: "discarded" });
        cancelled = true;
        cancelGeneration();
        return { ...result, applied: false, message: "User cancelled the edit" };
      }
    }

    if (name === "propose_delete") {
      const pending = getPendingDelete();
      const hasNewPending = pending && pending !== prevPendingDelete;
      if (hasNewPending && !toolCallFailed) {
        const confirmed = await promptForDeleteConfirmation(app, pending.path, pending.content);
        if (getPendingDelete() !== pending) return superseded();
        if (confirmed) {
          const deleteResult = await applyDelete(app);
          if (deleteResult.success) {
            processedDeletes.push({ path: pending.path, status: "deleted" });
            return { ...result, deleted: true, message: `Deleted "${pending.path}"` };
          }
          if (getPendingDelete() === pending) discardDelete(app);
          processedDeletes.push({ path: pending.path, status: "failed" });
          return { ...result, deleted: false, error: deleteResult.error };
        }
        if (getPendingDelete() === pending) discardDelete(app);
        processedDeletes.push({ path: pending.path, status: "cancelled" });
        return { ...result, deleted: false, message: "User cancelled the deletion" };
      }
    }

    if (name === "rename_note") {
      const pendingRn = getPendingRename();
      const hasNewPending = pendingRn && pendingRn !== prevPendingRename;
      if (hasNewPending && !toolCallFailed) {
        const confirmed = await promptForRenameConfirmation(app, pendingRn.originalPath, pendingRn.newPath);
        if (getPendingRename() !== pendingRn) return superseded();
        if (confirmed) {
          const renameResult = await applyRename(app);
          if (renameResult.success) {
            processedRenames.push({ originalPath: pendingRn.originalPath, newPath: pendingRn.newPath, status: "applied" });
            return { ...result, applied: true, message: `Renamed "${pendingRn.originalPath}" to "${pendingRn.newPath}"` };
          }
          if (getPendingRename() === pendingRn) discardRename(app);
          processedRenames.push({ originalPath: pendingRn.originalPath, newPath: pendingRn.newPath, status: "failed" });
          return { ...result, applied: false, error: renameResult.error };
        }
        if (getPendingRename() === pendingRn) discardRename(app);
        processedRenames.push({ originalPath: pendingRn.originalPath, newPath: pendingRn.newPath, status: "discarded" });
        return { ...result, applied: false, message: "User cancelled the rename" };
      }
    }

    if (name === "bulk_propose_edit") {
      const pendingBulk = getPendingBulkEdit();
      const hasNewPending = pendingBulk && pendingBulk !== prevPendingBulkEdit;
      if (hasNewPending && !toolCallFailed && pendingBulk.items.length > 0) {
        const selectedPaths = await promptForBulkEditConfirmation(app, pendingBulk.items);
        if (getPendingBulkEdit() !== pendingBulk) return superseded();
        if (selectedPaths.length > 0) {
          const applyResult = await applyBulkEdit(app, selectedPaths);
          for (const path of applyResult.applied) processedEdits.push({ originalPath: path, status: "applied" });
          for (const path of applyResult.failed) processedEdits.push({ originalPath: path, status: "failed" });
          return { ...result, applied: applyResult.applied, failed: applyResult.failed, message: applyResult.message };
        }
        discardBulkEdit();
        for (const item of pendingBulk.items) processedEdits.push({ originalPath: item.path, status: "discarded" });
        return { ...result, applied: [], message: "User cancelled all edits" };
      }
    }

    if (name === "bulk_propose_delete") {
      const pendingBulk = getPendingBulkDelete();
      const hasNewPending = pendingBulk && pendingBulk !== prevPendingBulkDelete;
      if (hasNewPending && !toolCallFailed && pendingBulk.items.length > 0) {
        const selectedPaths = await promptForBulkDeleteConfirmation(app, pendingBulk.items);
        if (getPendingBulkDelete() !== pendingBulk) return superseded();
        if (selectedPaths.length > 0) {
          const deleteResult = await applyBulkDelete(app, selectedPaths);
          for (const path of deleteResult.deleted) processedDeletes.push({ path, status: "deleted" });
          for (const path of deleteResult.failed) processedDeletes.push({ path, status: "failed" });
          return { ...result, deleted: deleteResult.deleted, failed: deleteResult.failed, message: deleteResult.message };
        }
        discardBulkDelete();
        for (const item of pendingBulk.items) processedDeletes.push({ path: item.path, status: "cancelled" });
        return { ...result, deleted: [], message: "User cancelled all deletions" };
      }
    }

    if (name === "bulk_propose_rename") {
      const pendingBulk = getPendingBulkRename();
      const hasNewPending = pendingBulk && pendingBulk !== prevPendingBulkRename;
      if (hasNewPending && !toolCallFailed && pendingBulk.items.length > 0) {
        const selectedPaths = await promptForBulkRenameConfirmation(app, pendingBulk.items);
        if (getPendingBulkRename() !== pendingBulk) return superseded();
        if (selectedPaths.length > 0) {
          const renameResult = await applyBulkRename(app, selectedPaths);
          for (const path of renameResult.applied) {
            const item = pendingBulk.items.find(i => i.originalPath === path);
            if (item) processedRenames.push({ originalPath: item.originalPath, newPath: item.newPath, status: "applied" });
          }
          for (const path of renameResult.failed) {
            const item = pendingBulk.items.find(i => i.originalPath === path);
            if (item) processedRenames.push({ originalPath: item.originalPath, newPath: item.newPath, status: "failed" });
          }
          return { ...result, applied: renameResult.applied, failed: renameResult.failed, message: renameResult.message };
        }
        discardBulkRename();
        for (const item of pendingBulk.items) {
          processedRenames.push({ originalPath: item.originalPath, newPath: item.newPath, status: "discarded" });
        }
        return { ...result, applied: [], message: "User cancelled all renames" };
      }
    }

    return result;
  };

  return { executeToolCall, processedEdits, processedDeletes, processedRenames, pendingAdditionalRequest };
}
