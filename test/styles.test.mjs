import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildChatStyles } from "../scripts/styles.mjs";

test("both plugin namespaces receive the same local UI and host mobile overrides survive", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chat-ui-styles-"));
  try {
    const outputs = [];
    for (const prefix of ["gemini-helper", "llm-hub"]) {
      const source = join(dir, `${prefix}.source.css`), output = join(dir, `${prefix}.css`);
      await writeFile(source, `.${prefix}-input-container.collapsed { border-top: none; }\n/* @chat-ui-styles */`);
      await buildChatStyles({ source, output, classPrefix: prefix });
      const result = await readFile(output, "utf8");
      assert.match(result, /input-container.collapsed/);
      assert.match(result, /justify-content: flex-end/);
      assert.match(result, new RegExp(`\\.${prefix}-message-user \\{[^}]*background: var\\(--interactive-accent\\)`, "s"));
      assert.match(result, new RegExp(`\\.${prefix}-html-buttons \\{[^}]*gap: 8px`, "s"));
      assert.match(result, new RegExp(`\\.${prefix}-image-actions \\{[^}]*gap: 8px`, "s"));
      assert.match(result, new RegExp(`\\.${prefix}-mcp-app-expanded \\{[^}]*position: fixed`, "s"));
      assert.match(result, new RegExp(`\\.${prefix}-mcp-app-resize-handle \\{[^}]*cursor: nwse-resize`, "s"));
      assert.doesNotMatch(result, /@chat-ui-styles|\.chat-ui-/);
      outputs.push(result.replaceAll(`${prefix}-`, "chat-ui-"));
    }
    assert.equal(outputs[0], outputs[1]);
    const source = join(dir, "missing.css");
    await writeFile(source, "body {}");
    await assert.rejects(buildChatStyles({ source, output: join(dir, "out.css"), classPrefix: "llm-hub" }), /Missing shared/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
