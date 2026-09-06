import { describe, expect, it } from "vitest";
import { matchFilePattern } from "./globMatcher.js";

describe("matchFilePattern", () => {
  it("matches * within one path segment and ** across segments", () => {
    expect(matchFilePattern("*.md", "a.md")).toBe(true);
    expect(matchFilePattern("*.md", "Notes/a.md")).toBe(false);
    expect(matchFilePattern("**/tmp/**", "Notes/tmp/a.md")).toBe(true);
    expect(matchFilePattern("Notes/*", "Notes/a.md")).toBe(true);
    expect(matchFilePattern("Notes/*", "Notes/sub/a.md")).toBe(false);
  });

  it("matches ? as one character that is not a separator", () => {
    expect(matchFilePattern("a?c.md", "abc.md")).toBe(true);
    expect(matchFilePattern("a?c.md", "a/c.md")).toBe(false);
  });

  it("expands braces into alternatives", () => {
    // The escaping pass used to turn the group this produces into literal
    // "(", "|" and ")", so a documented brace pattern matched nothing at all.
    expect(matchFilePattern("{a,b}.md", "a.md")).toBe(true);
    expect(matchFilePattern("{a,b}.md", "b.md")).toBe(true);
    expect(matchFilePattern("{a,b}.md", "c.md")).toBe(false);
    expect(matchFilePattern("**/{tmp,cache}/**", "Notes/tmp/a.md")).toBe(true);
    expect(matchFilePattern("**/{tmp,cache}/**", "Notes/cache/deep/a.md")).toBe(true);
    expect(matchFilePattern("**/{tmp,cache}/**", "Notes/keep/a.md")).toBe(false);
  });

  it("keeps escaping inside an alternative", () => {
    expect(matchFilePattern("{a.md,b.md}", "a.md")).toBe(true);
    expect(matchFilePattern("{a.md,b.md}", "axmd")).toBe(false);
    expect(matchFilePattern("{*.md,*.txt}", "notes.txt")).toBe(true);
  });

  it("supports character classes and negation", () => {
    expect(matchFilePattern("[ab].md", "a.md")).toBe(true);
    expect(matchFilePattern("[a-z].md", "q.md")).toBe(true);
    expect(matchFilePattern("[!a].md", "b.md")).toBe(true);
    expect(matchFilePattern("[!a].md", "a.md")).toBe(false);
  });

  it("treats regex metacharacters in a pattern as literal text", () => {
    expect(matchFilePattern("a+b.md", "a+b.md")).toBe(true);
    expect(matchFilePattern("a+b.md", "aab.md")).toBe(false);
    expect(matchFilePattern("notes(1).md", "notes(1).md")).toBe(true);
  });

  it("anchors to the whole path", () => {
    expect(matchFilePattern("tmp", "Notes/tmp/a.md")).toBe(false);
    expect(matchFilePattern("Notes/a.md", "Notes/a.md")).toBe(true);
  });
});
