import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/** Expand shared rules in place to preserve the host's CSS cascade and overrides. */
export async function buildChatStyles({ source = "styles.source.css", output = "styles.css", classPrefix }) {
  if (!/^[a-z][a-z0-9-]*$/.test(classPrefix)) throw new Error("Invalid chat class prefix");
  const [template, host] = await Promise.all([
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
    readFile(source, "utf8"),
  ]);
  if (!host.includes("/* @chat-ui-styles */")) throw new Error("Missing shared chat CSS marker");
  const result = host.replace("/* @chat-ui-styles */", () => template.replaceAll("chat-ui-", `${classPrefix}-`));
  let previous;
  try { previous = await readFile(output, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (previous !== result) await writeFile(output, result);
}

/** Include CSS in esbuild's watch graph without adding a runtime stylesheet import. */
export function chatStylesPlugin(options) {
  return {
    name: "shared-chat-styles",
    setup(build) {
      build.onResolve({ filter: /^chat-ui:styles$/ }, () => ({ path: "styles", namespace: "chat-ui" }));
      build.onLoad({ filter: /.*/, namespace: "chat-ui" }, async () => {
        await buildChatStyles(options);
        return { contents: "", loader: "js", watchFiles: [resolve(options.source ?? "styles.source.css"), fileURLToPath(new URL("../styles.css", import.meta.url))] };
      });
    },
  };
}
