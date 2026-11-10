import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { WorkflowGenerationModal } from "./WorkflowGenerationModal.js";
import { AIWorkflowModal } from "./AIWorkflowModal.js";

// The modal uses Obsidian's DOM helpers. Model the element operations needed for
// the confirmation -> active generation transition without a browser runtime.
class Element {
  children: Element[] = [];
  classes = new Set<string>();
  dataset: Record<string, string> = {};
  open = false;
  private text = "";
  private listeners = new Map<string, () => void>();
  get textContent() { return this.text; }
  set textContent(value: string) { this.text = value; this.children = []; }
  empty() { this.textContent = ""; }
  addClass(name: string) { this.classes.add(name); }
  removeClass(name: string) { this.classes.delete(name); }
  createEl(_tag: string, options: { cls?: string; text?: string } = {}) {
    const child = new Element();
    options.cls?.split(" ").forEach(name => child.addClass(name));
    child.textContent = options.text ?? "";
    child.parent = this;
    this.children.push(child);
    return child;
  }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  querySelector(selector: string): Element | undefined {
    return this.children.find(child => child.classes.has(selector.slice(1))) ??
      this.children.map(child => child.querySelector(selector)).find(Boolean);
  }
  addEventListener(event: string, callback: () => void) { this.listeners.set(event, callback); }
  click() { this.listeners.get("click")?.(); }
  parent?: Element;
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  querySelectorAll(selector: string): Element[] {
    return this.children.flatMap(child => [
      ...(child.classes.has(selector.slice(1)) ? [child] : []), ...child.querySelectorAll(selector),
    ]);
  }
  button(text: string): Element | undefined {
    return this.children.find(child => child.textContent === text) ??
      this.children.map(child => child.button(text)).find(Boolean);
  }
}

describe("workflow generation after plan approval", () => {
  afterEach(() => vi.restoreAllMocks());
  it("restores progress and Cancel when OK starts generation", async () => {
    const controller = new AbortController();
    const modal = new WorkflowGenerationModal(new App(), "Register skills/base in RAG", controller, () => {});
    const content = new Element();
    const status = new Element();
    const cancel = new Element();
    const plan = new Element();
    Object.assign(modal, { contentEl: content, statusEl: status, cancelBtn: cancel, planSectionEl: plan });

    modal.setPhase("planning");
    const confirmation = modal.showPlanConfirmation();
    expect(cancel.classes.has("is-hidden")).toBe(true);
    expect(status.querySelector(".chat-ui-workflow-generation-loading-dots")).toBeUndefined();

    content.button("OK")!.click();
    expect(await confirmation).toEqual({ action: "ok" });
    modal.setPhase("generating");

    expect(cancel.classes.has("is-hidden")).toBe(false);
    expect(status.textContent).not.toBe("");
    expect(status.children[0].children).toHaveLength(3);
    expect(plan.classes.has("is-collapsed")).toBe(true);
    expect(content.dataset.phase).toBe("generating");
    expect(controller.signal.aborted).toBe(false);
  });

  function openModal() {
    const controller = new AbortController();
    const onCancel = vi.fn();
    const modal = new WorkflowGenerationModal(new App(), "Register skills/base in RAG", controller, onCancel);
    const content = new Element();
    const status = content.createDiv();
    const cancel = content.createEl("button", { text: "Cancel" });
    Object.assign(modal, { contentEl: content, statusEl: status, cancelBtn: cancel, isOpen: true });
    return { modal, content, status, cancel, controller, onCancel };
  }

  it("shows a single group of loading dots after a re-plan and removes it on completion", () => {
    const { modal, status } = openModal();
    modal.setPhase("planning");
    modal.resetForReplan();
    expect(status.querySelectorAll(".chat-ui-workflow-generation-loading-dots")).toHaveLength(1);

    modal.setComplete();
    expect(status.querySelectorAll(".chat-ui-workflow-generation-loading-dots")).toHaveLength(0);
  });

  it("replaces Cancel with Close when generation fails", () => {
    const { modal, content, status, cancel, controller, onCancel } = openModal();
    const close = vi.spyOn(modal, "close").mockImplementation(() => {});
    modal.setPhase("generating");
    modal.showError("Error: Stream timed out");

    expect(status.textContent).toBe("Error: Stream timed out");
    expect(status.querySelectorAll(".chat-ui-workflow-generation-loading-dots")).toHaveLength(0);
    expect(cancel.classes.has("is-hidden")).toBe(true);
    content.button("Close")!.click();
    expect(close).toHaveBeenCalledOnce();
    expect(controller.signal.aborted).toBe(false);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("leaves a closed modal untouched when a later step fails", () => {
    const { modal, content, status } = openModal();
    modal.setPhase("generating");
    modal.onClose();
    modal.showError("Error: preview failed");

    expect(status.textContent).not.toContain("preview failed");
    expect(content.button("Close")).toBeUndefined();
  });

  it("keeps the error visible when generation times out before its first response", async () => {
    const resolve = vi.fn();
    const modal = new AIWorkflowModal(new App(), "modify", resolve, "existing YAML");
    vi.spyOn(WorkflowGenerationModal.prototype, "setPhase").mockImplementation(() => {});
    const close = vi.spyOn(WorkflowGenerationModal.prototype, "close");
    const showError = vi.spyOn(WorkflowGenerationModal.prototype, "showError");
    const error = "Stream timed out: no data received for 120 seconds";
    Object.assign(modal, {
      streamForWorkflow: async function* () { yield { type: "error", error }; },
    });
    // Invoke the generation flow directly, bypassing the input form.
    await (modal as unknown as { runGenerationLoop(...args: unknown[]): Promise<void> })
      .runGenerationLoop("Register skills/base in RAG", "base_skill", undefined, "local", [], undefined, "local");

    expect(close).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith(`Error: ${error}`);
    expect(resolve).toHaveBeenCalledWith(null);
  });
});
