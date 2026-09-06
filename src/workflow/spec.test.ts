import { describe, it, expect } from "vitest";
import {
  getWorkflowSpecification,
  getWorkflowNodeSpec,
  handleGetWorkflowSpec,
  GET_WORKFLOW_SPEC_TOOL,
  WORKFLOW_SPECIFICATION,
} from "./spec.js";
import { WORKFLOW_NODE_TYPES } from "./types.js";

const context = { modelNames: ["api:openai", "claude-cli"], mcpServers: [], ragSettingNames: ["notes"] };

describe("workflow specification", () => {
  it("documents every node type the executor accepts", () => {
    const spec = getWorkflowSpecification(context);
    const documented = new Set([...spec.matchAll(/^#### (\S+)/gm)].map(m => m[1]));
    expect([...WORKFLOW_NODE_TYPES].filter(type => !documented.has(type))).toEqual([]);
  });

  it("lists the host's own models and RAG settings", () => {
    const spec = getWorkflowSpecification(context);
    expect(spec).toContain("api:openai, claude-cli");
    expect(spec).toContain("notes");
  });

  it("still renders with nothing configured", () => {
    expect(WORKFLOW_SPECIFICATION.length).toBeGreaterThan(1000);
  });
});

describe("getWorkflowNodeSpec", () => {
  it("returns the whole spec when no node type is asked for", () => {
    expect(getWorkflowNodeSpec(undefined, context)).toBe(getWorkflowSpecification(context));
    expect(getWorkflowNodeSpec([], context)).toBe(getWorkflowSpecification(context));
  });

  it("returns only the sections asked for", () => {
    const section = getWorkflowNodeSpec(["http"], context);
    expect(section.startsWith("#### http")).toBe(true);
    expect(section).not.toContain("#### command");
  });

  it("says so rather than staying silent about an unknown node type", () => {
    expect(getWorkflowNodeSpec(["not-a-node"], context)).toContain("unknown node type");
  });
});

describe("handleGetWorkflowSpec", () => {
  it("accepts the array the tool schema declares", () => {
    expect(handleGetWorkflowSpec({ nodeTypes: ["http"] }, context).result).toContain("#### http");
  });

  it("accepts a JSON-encoded array, which some models send instead", () => {
    const result = handleGetWorkflowSpec({ nodeTypes: '["http", "command"]' }, context).result;
    expect(result).toContain("#### http");
    expect(result).toContain("#### command");
  });

  it("accepts bare and comma-separated names", () => {
    expect(handleGetWorkflowSpec({ nodeTypes: "http" }, context).result).toContain("#### http");
    expect(handleGetWorkflowSpec({ nodeTypes: "http, command" }, context).result).toContain("#### command");
  });

  it("falls back to the full spec for an empty request", () => {
    expect(handleGetWorkflowSpec({}, context).result).toBe(getWorkflowSpecification(context));
    expect(handleGetWorkflowSpec({ nodeTypes: "  " }, context).result).toBe(getWorkflowSpecification(context));
  });

  it("declares itself to the model as an array of node types", () => {
    expect(GET_WORKFLOW_SPEC_TOOL.parameters.properties.nodeTypes.type).toBe("array");
  });
});
