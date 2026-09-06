import { describe, expect, it } from "vitest";
import {
  applyComposerSelection,
  detectComposerTrigger,
  filterByPrefix,
  filterByQuery,
  messageAfterCommand,
} from "./composerAutocomplete.js";

describe("detectComposerTrigger", () => {
  it("offers commands only at the start of the box", () => {
    expect(detectComposerTrigger("/pl", 3)).toEqual({ kind: "command", query: "pl" });
    expect(detectComposerTrigger("read and/or write", 17)).toBeNull();
  });

  it("finds an unclosed wikilink before the caret", () => {
    expect(detectComposerTrigger("see [[pro", 9)).toEqual({ kind: "wikilink", query: "pro", startPos: 4 });
    expect(detectComposerTrigger("see [[project]] now", 19)).toBeNull();
  });

  it("finds an @ mention before the caret", () => {
    expect(detectComposerTrigger("ask @pl", 7)).toEqual({ kind: "mention", query: "pl", startPos: 4 });
    expect(detectComposerTrigger("ask @plan then", 14)).toBeNull();
  });

  it("prefers the wikilink when both markers are open", () => {
    // "@" inside an unclosed "[[" is part of the file name being typed.
    expect(detectComposerTrigger("[[notes/@wip", 12)).toMatchObject({ kind: "wikilink", query: "notes/@wip" });
  });

  it("reads the text before the caret, not the whole box", () => {
    expect(detectComposerTrigger("ask @pl and more", 7)).toEqual({ kind: "mention", query: "pl", startPos: 4 });
  });
});

describe("filterByQuery", () => {
  const files = ["Notes/plan.md", "Archive/old-plan.md", "Journal.md"];

  it("matches anywhere in the text, case-insensitively", () => {
    expect(filterByQuery(files, "PLAN", f => f)).toEqual(["Notes/plan.md", "Archive/old-plan.md"]);
  });

  it("offers the first items when nothing has been typed yet", () => {
    expect(filterByQuery(files, "", f => f, 2)).toEqual(["Notes/plan.md", "Archive/old-plan.md"]);
  });
});

describe("filterByPrefix", () => {
  it("matches only from the start, so /plan does not offer replan", () => {
    expect(filterByPrefix(["plan", "replan", "planner"], "plan", c => c)).toEqual(["plan", "planner"]);
  });
});

describe("applyComposerSelection", () => {
  it("wraps a wikilink and leaves the caret after it", () => {
    expect(applyComposerSelection("see [[pro", 4, 9, "projects/roadmap.md", "wikilink"))
      .toEqual({ text: "see [[projects/roadmap.md]]", caret: 27 });
  });

  it("gives a mention a trailing space so the next word does not extend it", () => {
    expect(applyComposerSelection("ask @pl about", 4, 7, "{selection}", "mention"))
      .toEqual({ text: "ask {selection}  about", caret: 16 });
  });
});

describe("messageAfterCommand", () => {
  it("returns what follows the command", () => {
    expect(messageAfterCommand("/plan write the intro", "plan")).toBe("write the intro");
    expect(messageAfterCommand("/plan", "plan")).toBe("");
  });

  it("does not treat a longer command as this one", () => {
    // "/planner" must not be read as "/plan" with "ner" as the message.
    expect(messageAfterCommand("/planner do it", "plan")).toBeNull();
  });

  it("matches the name case-insensitively", () => {
    expect(messageAfterCommand("/Plan do it", "plan")).toBe("do it");
  });
});
