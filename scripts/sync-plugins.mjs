import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const consumers = process.argv.slice(2).map(path => resolve(path));
if (!consumers.length) throw new Error("Usage: npm run sync-plugins -- <plugin-directory> [...]");
function npm(args, cwd, capture = false) {
  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", args, { cwd, encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `npm ${args.join(" ")} failed`);
  return result.stdout;
}
npm(["run", "build"], packageRoot);
npm(["test"], packageRoot);
const temporary = mkdtempSync(join(tmpdir(), "obsidian-llm-hub-chat-ui-pack-"));
try {
  const [{ filename }] = JSON.parse(npm(["pack", "--ignore-scripts", "--json", "--pack-destination", temporary], packageRoot, true));
  for (const consumer of consumers) {
    const vendor = join(consumer, "vendor");
    mkdirSync(vendor, { recursive: true });
    copyFileSync(join(temporary, filename), join(vendor, filename));
    npm(["install", "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact", `file:vendor/${filename}`], consumer);
  }
} finally { rmSync(temporary, { recursive: true, force: true }); }
