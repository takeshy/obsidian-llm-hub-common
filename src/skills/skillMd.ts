import { parseYaml, stringifyYaml } from "obsidian";

/**
 * SKILL.md is frontmatter plus a body that may carry a fenced capabilities block. These read and
 * write that shape; what a skill *means* stays with the plugin that loads it.
 */
const WARNED_SKILL_PATHS = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (WARNED_SKILL_PATHS.has(key)) return;
  WARNED_SKILL_PATHS.add(key);
  console.warn(message);
}

/** The fence tag SKILL.md uses for its capabilities block. */
export const SKILL_CAPABILITIES_FENCE_TAG = "skill-capabilities";

const CAPABILITIES_FENCE_RE = new RegExp(
  `^\`\`\`${SKILL_CAPABILITIES_FENCE_TAG}[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n\`\`\`[ \\t]*$`,
  "m",
);

/**
 * Reads the fenced capabilities block. The fence is the single source of truth for a skill's
 * workflow and script definitions; frontmatter holds only user-facing metadata. Returns null when
 * the block is absent or not valid YAML, logging once per context so a typo stays visible.
 */
export function extractCapabilitiesBlock(
  body: string,
  warnContext?: string,
): Record<string, unknown> | null {
  const match = body.match(CAPABILITIES_FENCE_RE);
  if (!match) return null;
  try {
    const parsed: unknown = parseYaml(match[1]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (e) {
    if (warnContext) {
      warnOnce(
        `capabilities-parse:${warnContext}`,
        `[skills] ${warnContext}: failed to parse \`skill-capabilities\` YAML block — ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return null;
}

/**
 * Replace (or insert) the ```skill-capabilities fenced YAML block inside a
 * SKILL.md body, preserving any prose around it. When no existing block is
 * found the new one is prepended so the LLM sees capabilities before the
 * instructions prose.
 */
export function upsertCapabilitiesBlock(body: string, capabilities: Record<string, unknown>): string {
  const yamlContent = stringifyYaml(capabilities).trimEnd();
  const newBlock = `\`\`\`${SKILL_CAPABILITIES_FENCE_TAG}\n${yamlContent}\n\`\`\``;
  if (CAPABILITIES_FENCE_RE.test(body)) {
    return body.replace(CAPABILITIES_FENCE_RE, newBlock);
  }
  const trimmed = body.replace(/^\s+/, "");
  return trimmed ? `${newBlock}\n\n${trimmed}` : `${newBlock}\n`;
}

/** Serialize a SKILL.md file from frontmatter + body. */
export function writeSkillMd(frontmatter: Record<string, unknown>, body: string): string {
  return `---\n${stringifyYaml(frontmatter).trimEnd()}\n---\n\n${body.replace(/^\s+/, "")}`;
}

/**
 * Discover all skills: built-in skills + vault skills.
 *
 * For vault skills the single source of truth is the `skill-capabilities`
 * fenced YAML block inside SKILL.md. Frontmatter carries only user-facing
 * metadata (name, description). If a skill still declares `workflows:` /
 * `scripts:` in frontmatter (legacy format), they are accepted for backward
 * compatibility with a one-time console warning suggesting migration.
 *
 * Expected layout:
 * ```markdown
 * ---
 * name: my-skill
 * description: ...
 * ---
 *
 * ```skill-capabilities
 * workflows:
 *   - path: workflows/do-x.md
 *     description: ...
 *     inputVariables: [filePath, mode]
 * scripts:
 *   - path: scripts/check.sh
 *     description: ...
 * ```
 *
 * <prose body>
 * ```
 */

export function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  try {
    const frontmatter = (parseYaml(match[1]) as Record<string, unknown>) || {};
    return { frontmatter, body: match[2] };
  } catch {
    return { frontmatter: {}, body: match[2] };
  }
}
