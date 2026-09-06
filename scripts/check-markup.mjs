import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/** Classes the shared stylesheet defines. Their markup must live in this library, not in a host. */
export async function sharedStyledClasses() {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  return new Set([...css.matchAll(/\.chat-ui-([a-z0-9-]+)/g)].map(match => match[1]));
}

async function sourceFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (/\.tsx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

/** Host markup that re-implements shared UI. Anything not in `allow` is drift waiting to happen. */
export async function findSharedMarkup({ dir, classPrefix, allow = [] }) {
  const owned = await sharedStyledClasses();
  const allowed = new Set(allow);
  const pattern = new RegExp(`${classPrefix}-([a-z0-9-]+)`, "g");
  const findings = [];
  for (const file of await sourceFiles(dir)) {
    (await readFile(file, "utf8")).split("\n").forEach((line, index) => {
      for (const [, name] of line.matchAll(pattern)) {
        if (owned.has(name) && !allowed.has(name)) findings.push({ file, line: index + 1, className: `${classPrefix}-${name}` });
      }
    });
  }
  return findings;
}
