import { describe, expect, it } from "vitest";
import { withRequestedSkillPath } from "./contextSkills.js";

const MARKDOWN = "builtin:markdown";
const CUSTOM = "custom:review";

describe("withRequestedSkillPath", () => {
  it("keeps the selection when nothing is requested", () => {
    const selection = [CUSTOM];
    expect(withRequestedSkillPath(selection)).toBe(selection);
  });

  it("adds a requested skill for the send", () => {
    expect(withRequestedSkillPath([CUSTOM], MARKDOWN)).toEqual([CUSTOM, MARKDOWN]);
  });

  it("does not repeat a skill that is already selected", () => {
    expect(withRequestedSkillPath([MARKDOWN, CUSTOM], MARKDOWN)).toEqual([MARKDOWN, CUSTOM]);
  });
});
