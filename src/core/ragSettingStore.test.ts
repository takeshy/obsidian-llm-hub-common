import { describe, expect, it } from "vitest";
import {
  assertNoRagSettingCollision,
  deleteRagSettingFromState,
  pruneRagSettingSources,
  renameRagSettingInState,
  sanitizeRagSettingName,
} from "./ragSettingStore.js";

interface Setting { sourceRagSettings?: string[] }

const state = (settings: Record<string, Setting>, selected: string | null = null) =>
  ({ selectedRagSetting: selected, ragSettings: settings });

describe("sanitizeRagSettingName", () => {
  it("keeps what a directory name may hold and replaces the rest", () => {
    expect(sanitizeRagSettingName("Notes-v1.2_x")).toBe("Notes-v1.2_x");
    expect(sanitizeRagSettingName("My Index")).toBe("My_Index");
    expect(sanitizeRagSettingName("a/b")).toBe("a_b");
  });
});

describe("assertNoRagSettingCollision", () => {
  it("refuses a name that would share a directory with an existing setting", () => {
    // Both reduce to "My_Index": one index directory, two settings writing to it.
    expect(() => assertNoRagSettingCollision(state({ "My Index": {} }), "My/Index")).toThrow(/conflicts/);
  });

  it("allows an unrelated name and a setting keeping its own directory", () => {
    expect(() => assertNoRagSettingCollision(state({ "My Index": {} }), "Other")).not.toThrow();
    expect(() => assertNoRagSettingCollision(state({ "My Index": {} }), "My_Index", "My Index")).not.toThrow();
  });
});

describe("renameRagSettingInState", () => {
  it("follows the name into the selection and into settings built from it", () => {
    const current = state({ source: {}, bundle: { sourceRagSettings: ["source", "other"] } }, "source");
    renameRagSettingInState(current, "source", "renamed");
    expect(Object.keys(current.ragSettings).sort()).toEqual(["bundle", "renamed"]);
    expect(current.ragSettings.bundle.sourceRagSettings).toEqual(["renamed", "other"]);
    expect(current.selectedRagSetting).toBe("renamed");
  });

  it("leaves a selection that pointed elsewhere alone", () => {
    const current = state({ a: {}, b: {} }, "b");
    renameRagSettingInState(current, "a", "c");
    expect(current.selectedRagSetting).toBe("b");
  });
});

describe("deleteRagSettingFromState", () => {
  it("removes every reference rather than leaving a name that resolves to nothing", () => {
    const current = state({ source: {}, bundle: { sourceRagSettings: ["source", "other"] } }, "source");
    deleteRagSettingFromState(current, "source");
    expect(current.ragSettings.source).toBeUndefined();
    expect(current.ragSettings.bundle.sourceRagSettings).toEqual(["other"]);
    expect(current.selectedRagSetting).toBeNull();
  });
});

describe("pruneRagSettingSources", () => {
  it("drops a setting listing itself and sources that no longer exist", () => {
    const current = state({ a: {}, bundle: {} });
    expect(pruneRagSettingSources(current, "bundle", { sourceRagSettings: ["a", "bundle", "gone"] }))
      .toEqual({ sourceRagSettings: ["a"] });
  });

  it("returns a setting with no sources untouched", () => {
    const setting = {};
    expect(pruneRagSettingSources(state({}), "x", setting)).toBe(setting);
  });
});
