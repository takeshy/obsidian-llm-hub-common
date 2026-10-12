import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import type { LoadedSkill } from "../skills/skillsLoader.js";
import { READ_SKILL_TOOL_NAME, SKILL_SCRIPT_TOOL_NAME, SKILL_WORKFLOW_TOOL_NAME } from "../skills/skillTools.js";
import { createSkillToolset } from "./skillToolset.js";
import { processSkillMarkers } from "./skillMarkers.js";

const app = { vault: { getAbstractFileByPath: () => null } } as unknown as App;
function skill(overrides: Partial<LoadedSkill> = {}): LoadedSkill {
  return { name: "s", description: "", folderPath: "Skills/s", skillFilePath: "Skills/s/SKILL.md", workflows: [], scripts: [], instructions: "Body", references: [], ...overrides };
}

describe("skill toolset", () => {
  it("offers only the tools the active skills need", () => {
    const names = (skills: LoadedSkill[], runScript?: () => Promise<Record<string, unknown>>) =>
      createSkillToolset(app, skills, { vaultToolAllowedFolders: undefined, readSkillMarker: false, runScript }).tools.map(tool => tool.name);
    expect(names([skill()])).toEqual([]);
    expect(names([skill({ instructions: "" })])).toEqual([READ_SKILL_TOOL_NAME]);
    const withAll = skill({ workflows: [{ path: "workflows/a.md", description: "A" }], scripts: [{ path: "scripts/a.sh", name: "a", description: "A" }] });
    expect(names([withAll])).toEqual([SKILL_WORKFLOW_TOOL_NAME]);
    expect(names([withAll], async () => ({}))).toEqual([SKILL_WORKFLOW_TOOL_NAME, SKILL_SCRIPT_TOOL_NAME]);
  });

  it("refuses tools it did not offer", async () => {
    const toolset = createSkillToolset(app, [skill()], { vaultToolAllowedFolders: undefined, readSkillMarker: false });
    expect(toolset.has(SKILL_WORKFLOW_TOOL_NAME)).toBe(false);
    expect(await toolset.execute(SKILL_WORKFLOW_TOOL_NAME, { workflowId: "x" })).toEqual({ error: `Unknown tool: ${SKILL_WORKFLOW_TOOL_NAME}` });
  });
});

describe("skill markers", () => {
  it("ends the loop when no marker ran", async () => {
    expect(await processSkillMarkers(app, "Plain answer", [skill()])).toEqual({ processedContent: "Plain answer" });
  });

  it("reports unknown skills back to the model", async () => {
    const result = await processSkillMarkers(app, "[READ_SKILL: other]", [skill()]);
    expect(result.followUpMessage).toContain("Unknown skill: other");
  });

  it("runs script markers only through a host runner", async () => {
    const text = "[RUN_SCRIPT: s/a](['x'])";
    expect((await processSkillMarkers(app, text, [skill()])).followUpMessage).toBeUndefined();
    const ran: string[] = [];
    const result = await processSkillMarkers(app, text, [skill()], { runScript: async (id) => { ran.push(id); return { ok: true }; } });
    expect(ran).toEqual(["s/a"]);
    expect(result.followUpMessage).toContain('Script "s/a" result');
  });
});
