import { describe, expect, it } from "vitest";
import {
  READ_SKILL_TOOL,
  READ_SKILL_TOOL_NAME,
  SKILL_SCRIPT_TOOL_NAME,
  SKILL_WORKFLOW_TOOL_NAME,
  createSkillScriptTool,
  createSkillWorkflowTool,
  executeReadSkillTool,
} from "./skillTools.js";
import { getBuiltinSkillMetadata } from "./builtinSkills.js";

describe("skill tool definitions", () => {
  it("names the tools the executors dispatch on", () => {
    expect(READ_SKILL_TOOL.name).toBe(READ_SKILL_TOOL_NAME);
    expect(createSkillWorkflowTool({ readSkillMarker: false }).name).toBe(SKILL_WORKFLOW_TOOL_NAME);
    expect(createSkillScriptTool({ readSkillMarker: false }).name).toBe(SKILL_SCRIPT_TOOL_NAME);
  });

  it("offers the READ_SKILL marker only to hosts that resolve it", () => {
    for (const create of [createSkillWorkflowTool, createSkillScriptTool]) {
      expect(create({ readSkillMarker: true }).description).toContain("[READ_SKILL: ...]");
      expect(create({ readSkillMarker: false }).description).not.toContain("READ_SKILL");
      expect(create({ readSkillMarker: false }).description).toContain("read_skill");
    }
  });

  it("requires the id the executor reads", () => {
    expect(READ_SKILL_TOOL.parameters.required).toEqual(["skillName"]);
    expect(createSkillWorkflowTool({ readSkillMarker: true }).parameters.required).toEqual(["workflowId"]);
    expect(createSkillScriptTool({ readSkillMarker: true }).parameters.required).toEqual(["scriptId"]);
  });

  it("reads only a skill that is active in this chat", async () => {
    const skill = getBuiltinSkillMetadata()[0];
    expect(await executeReadSkillTool({} as never, [], skill.name))
      .toEqual({ error: `Skill is not active: ${skill.name}` });
  });
});
