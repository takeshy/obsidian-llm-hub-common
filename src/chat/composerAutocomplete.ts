/**
 * What the composer offers for the text typed so far. The trigger is decided
 * from the text and the caret alone, so the three plugins cannot disagree about
 * when a menu opens.
 */
export type ComposerTrigger =
  | { kind: "command"; query: string }
  | { kind: "wikilink"; query: string; startPos: number }
  | { kind: "mention"; query: string; startPos: number }
  | null;

/**
 * A slash command only counts at the very start of the box — a "/" mid-sentence
 * is punctuation. "[[" and "@" count wherever the caret is.
 */
export function detectComposerTrigger(value: string, cursorPos: number): ComposerTrigger {
  if (value.startsWith("/")) return { kind: "command", query: value.slice(1).toLowerCase() };

  const textBeforeCursor = value.slice(0, cursorPos);

  const wikiMatch = textBeforeCursor.match(/\[\[([^\]\n]*)$/);
  if (wikiMatch) {
    return { kind: "wikilink", query: wikiMatch[1], startPos: cursorPos - wikiMatch[0].length };
  }

  const atMatch = textBeforeCursor.match(/@([^\s@]*)$/);
  if (atMatch) {
    return { kind: "mention", query: atMatch[1], startPos: cursorPos - atMatch[0].length };
  }

  return null;
}

/** Case-insensitive substring match, capped so the menu stays a menu. */
export function filterByQuery<T>(items: T[], query: string, toText: (item: T) => string, limit = 10): T[] {
  if (!query) return items.slice(0, limit);
  const lowerQuery = query.toLowerCase();
  return items.filter((item) => toText(item).toLowerCase().includes(lowerQuery)).slice(0, limit);
}

/** Commands whose name starts with what has been typed after the slash. */
export function filterByPrefix<T>(items: T[], query: string, toName: (item: T) => string): T[] {
  return items.filter((item) => toName(item).toLowerCase().startsWith(query));
}

/**
 * Replace the trigger text with the chosen value, and say where the caret goes.
 * A wikilink is wrapped in brackets; a mention gets a trailing space so the next
 * word does not extend it.
 */
export function applyComposerSelection(
  value: string,
  startPos: number,
  cursorPos: number,
  selected: string,
  kind: "wikilink" | "mention",
): { text: string; caret: number } {
  const inserted = kind === "wikilink" ? `[[${selected}]]` : `${selected} `;
  return {
    text: value.slice(0, startPos) + inserted + value.slice(cursorPos),
    caret: startPos + inserted.length,
  };
}

/**
 * The message left after a `/<command>` prefix, or null when the text is not
 * that command. The prefix has to be followed by a space or end the text, so
 * "/plan" does not swallow "/planner".
 */
export function messageAfterCommand(input: string, commandName: string): string | null {
  const trimmed = input.trim();
  const prefix = `/${commandName}`;
  if (!trimmed.toLowerCase().startsWith(prefix.toLowerCase())) return null;
  if (trimmed.length !== prefix.length && trimmed[prefix.length] !== " ") return null;
  return trimmed.slice(prefix.length).trim();
}
