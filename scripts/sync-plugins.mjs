import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const consumers = process.argv.slice(2).map(path => resolve(path));
if (!consumers.length) throw new Error("Usage: npm run sync-plugins -- <plugin-directory> [...]");
function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `${command} ${args.join(" ")} failed`);
  return result.stdout;
}
const git = args => run("git", args, packageRoot, true).trim();
if (git(["status", "--porcelain"])) throw new Error("Commit library changes before syncing consumers.");
const commit = git(["rev-parse", "HEAD"]);
const repository = "https://github.com/takeshy/obsidian-llm-hub-chat-ui.git";
const remoteCommit = git(["ls-remote", repository, "refs/heads/main"]).split(/\s+/)[0];
if (commit !== remoteCommit) throw new Error("Push the library commit to main before syncing consumers.");
// Validate every target before updating any dependency.
for (const consumer of consumers) JSON.parse(readFileSync(join(consumer, "package.json"), "utf8"));
for (const consumer of consumers) {
  run(process.platform === "win32" ? "npm.cmd" : "npm", [
    "install", "--no-audit", "--no-fund", "--save-exact", `git+${repository}#${commit}`,
  ], consumer);
}
