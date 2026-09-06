import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";

vi.mock("obsidian", () => ({
  parseYaml: (source: string) => Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*["']?(.*?)["']?\s*$/);
    return match ? [[match[1], match[2]]] : [];
  })),
}));

import {
  buildBuiltinOkfSystemPrompt,
  buildOkfSystemPrompt,
  configureBuiltinOkf,
  discoverOkfBundles,
  readOkfDocument,
} from "./okfLoader.js";

// Stands in for the help bundle a plugin generates and registers at load.
const BUILTIN_OKF_BUNDLE_ID = "builtin:help";
configureBuiltinOkf({
  id: BUILTIN_OKF_BUNDLE_ID,
  name: "Plugin help",
  documents: [
    {
      path: "index.md",
      type: "index",
      title: "Plugin help",
      description: "What the plugin can do",
      tags: [],
      body: "- [OKF](features/okf.md) — knowledge bundles",
    },
    {
      path: "features/okf.md",
      type: "feature",
      title: "OKF",
      description: "Knowledge bundles",
      tags: ["okf"],
      body: "OKF bundles are progressive-disclosure documents.",
    },
  ],
});
import { executeReadOkfDocumentTool } from "./okfDocumentTool.js";

function makeApp(files: Record<string, string>): App {
  const entries = Object.keys(files).map(path => ({ path }));
  return { vault: { getMarkdownFiles: () => entries, cachedRead: async (file: { path: string }) => files[file.path] } } as unknown as App;
}

describe("dynamic OKF loading", () => {
  let app: App;
  beforeEach(() => {
    app = makeApp({
      "Knowledge/team/index.md": "---\ntitle: Team Guide\ndescription: Main index\n---\n# Team\n\n- [Details](./details.md)\n- [Topics](./topics/)",
      "Knowledge/team/details.md": "---\ntitle: Details\n---\n# Details\n\nFirst paragraph.\n\n- item one\n- item two",
      "Knowledge/team/topics/index.md": "---\ntitle: Topics\n---\n# Topics",
      "Knowledge/team/log.md": "private change history",
    });
  });

  it("injects only a bundle index while preserving Markdown", async () => {
    const prompt = await buildOkfSystemPrompt(app, "Knowledge", ["team"]);
    expect(prompt).toContain("bundleId=team");
    expect(prompt).toContain("# Team\n\n- [Details]");
    expect(prompt).not.toContain("First paragraph");
  });

  it("reads documents and directory indexes on demand", async () => {
    expect((await readOkfDocument(app, "Knowledge", "team", "/details.md"))?.body).toContain("First paragraph.\n\n- item one");
    expect((await readOkfDocument(app, "Knowledge", "team", "./topics/"))?.path).toBe("team/topics/index.md");
  });

  it("does not expose nested indexes as bundles", async () => {
    await expect(discoverOkfBundles(app, "Knowledge")).resolves.toEqual([{ id: "team", name: "Team Guide" }]);
  });

  it("rejects logs, traversal, and inactive bundles", async () => {
    await expect(readOkfDocument(app, "Knowledge", "team", "log.md")).resolves.toBeNull();
    await expect(readOkfDocument(app, "Knowledge", "team", "../other.md")).resolves.toBeNull();
    await expect(executeReadOkfDocumentTool(app, "Knowledge", [], "team", "details.md"))
      .resolves.toEqual({ error: "OKF bundle is not active: bundleId=team" });
  });

  it("loads built-in documents on demand", async () => {
    const prompt = buildBuiltinOkfSystemPrompt();
    expect(prompt).toContain(`bundleId=${BUILTIN_OKF_BUNDLE_ID}`);
    expect(prompt).not.toContain("# OKF knowledge sources");
    const doc = await readOkfDocument(app, null, BUILTIN_OKF_BUNDLE_ID, "features/okf.md");
    expect(doc?.body).toContain("progressive-disclosure documents");
  });
});
