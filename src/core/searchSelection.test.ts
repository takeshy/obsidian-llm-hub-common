import { describe, expect, it } from "vitest";
import {
  EMPTY_SEARCH_SELECTION,
  getEffectiveSearchSelection,
  getSlashCommandSearchSelection,
  normalizeSearchSelection,
  searchSelectionFromLegacy,
  searchSelectionFromWorkspace,
} from "./searchSelection.js";

describe("searchSelectionFromLegacy", () => {
  it("keeps null meaning \"whatever the chat has\"", () => {
    expect(searchSelectionFromLegacy(null)).toBeNull();
    expect(searchSelectionFromLegacy(undefined)).toBeNull();
  });

  it("reads the three stored single-choice values", () => {
    expect(searchSelectionFromLegacy("")).toEqual(EMPTY_SEARCH_SELECTION);
    expect(searchSelectionFromLegacy("__websearch__")).toEqual({ webSearch: true, ragSetting: null });
    expect(searchSelectionFromLegacy("Research")).toEqual({ webSearch: false, ragSetting: "Research" });
  });
});

describe("getSlashCommandSearchSelection", () => {
  it("prefers the combined value over the legacy one", () => {
    expect(getSlashCommandSearchSelection({
      searchSelection: { webSearch: true, ragSetting: "Research" },
      searchSetting: "Old index",
    })).toEqual({ webSearch: true, ragSetting: "Research" });
  });

  it("treats an explicit null as \"keep the current setting\", not as \"no search\"", () => {
    expect(getSlashCommandSearchSelection({ searchSelection: null, searchSetting: "Old index" })).toBeNull();
  });

  it("falls back to the legacy value on a command saved before the split", () => {
    expect(getSlashCommandSearchSelection({ searchSetting: "__websearch__" }))
      .toEqual({ webSearch: true, ragSetting: null });
    expect(getSlashCommandSearchSelection({})).toBeNull();
  });
});

describe("searchSelectionFromWorkspace", () => {
  it("lifts the Web-only marker out of the RAG slot it used to occupy", () => {
    expect(searchSelectionFromWorkspace("__websearch__", false)).toEqual({ webSearch: true, ragSetting: null });
  });

  it("keeps Web and RAG together once both are stored", () => {
    expect(searchSelectionFromWorkspace("Research", true)).toEqual({ webSearch: true, ragSetting: "Research" });
  });
});

describe("normalizeSearchSelection", () => {
  it("treats an empty index name as no index", () => {
    expect(normalizeSearchSelection({ webSearch: true, ragSetting: "" })).toEqual({ webSearch: true, ragSetting: null });
  });
});

describe("getEffectiveSearchSelection", () => {
  it("does not forget preferences the current model cannot honour", () => {
    const remembered = { webSearch: true, ragSetting: "Research" };
    expect(getEffectiveSearchSelection(remembered, false, false)).toEqual({ webSearch: false, ragSetting: null });
    expect(remembered).toEqual({ webSearch: true, ragSetting: "Research" });
  });

  it("resolves each capability on its own", () => {
    const remembered = { webSearch: true, ragSetting: "Research" };
    expect(getEffectiveSearchSelection(remembered, true, false)).toEqual({ webSearch: true, ragSetting: null });
    expect(getEffectiveSearchSelection(remembered, false, true)).toEqual({ webSearch: false, ragSetting: "Research" });
  });
});
