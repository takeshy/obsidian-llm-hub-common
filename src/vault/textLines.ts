export interface TextLineSelection {
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
}

/** Select an inclusive, 1-based line range while preserving the original line endings. */
export function selectTextLines(text: string, startLine?: number, endLine?: number): TextLineSelection {
  const lines = text.split(/(?<=\n)/);
  // split() leaves an empty sentinel after a final newline; it is not another line.
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  const totalLines = Math.max(lines.length, 1);
  const first = startLine ?? 1;
  const last = Math.min(endLine ?? totalLines, totalLines);
  return {
    content: first > totalLines ? "" : lines.slice(first - 1, last).join(""),
    startLine: first,
    endLine: first > totalLines ? totalLines : last,
    totalLines,
  };
}

export interface TextContextMatch {
  startLine: number;
  endLine: number;
  content: string;
}

/** Return merged line windows around every case-insensitive literal match. */
export function findTextContexts(text: string, searchTerm: string, linesBefore: number, linesAfter: number): TextContextMatch[] {
  const lines = text.split(/\r?\n/);
  const needle = searchTerm.toLocaleLowerCase();
  const ranges = lines.flatMap((line, index) => line.toLocaleLowerCase().includes(needle)
    ? [{ start: Math.max(0, index - linesBefore), end: Math.min(lines.length - 1, index + linesAfter) }]
    : []);
  const merged: typeof ranges = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + 1) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged.map(range => ({
    startLine: range.start + 1,
    endLine: range.end + 1,
    content: lines.slice(range.start, range.end + 1).join("\n"),
  }));
}
