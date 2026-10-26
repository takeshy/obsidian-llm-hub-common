import { describe, expect, it, vi } from "vitest";
import { type App, TFile } from "obsidian";
import { formatComposerMention, messagesForModel, resolveChatFileMentions } from "./fileMentions.js";

const sources = {
  takeExternalSelection: () => null,
  getLastSelection: () => "",
  getSelectionLocation: () => null,
};

function setup() {
  const files = ["Projects/My Note.md", "Note.md", "資料/計画.pdf"].map(path =>
    Object.assign(new TFile(), { path, extension: path.split(".").pop(), stat: { size: 125000, mtime: 0, ctime: 0 } }),
  );
  const readText = vi.fn(async (file: TFile) => `Text from ${file.path}`);
  const lookup = vi.fn((linkpath: string) => files.find(file =>
    file.path === linkpath || file.path.replace(/\.(md|pdf)$/, "") === linkpath,
  ) ?? null);
  const app = {
    vault: { getFiles: () => files },
    workspace: { getActiveFile: () => ({ path: "Projects/Active.md" }) },
    metadataCache: { getFirstLinkpathDest: lookup },
  } as unknown as App;
  const resolve = (content: string, inlineFileMentions = true) => resolveChatFileMentions(app, content, sources, {
    inlineFileMentions, readMentionText: readText,
  }).then(result => result.llmContent);
  return { app, resolve, readText, lookup };
}

describe("chat file mentions", () => {
  it.each(["[[Note.md]]", "[[Note]]", "@Note.md", "Note.md"])("passes %s as an exact path for read_note when vault tools are enabled", async reference => {
    const { resolve, readText } = setup();
    const result = await resolve(`Discuss ${reference}`, false);
    expect(result.trim().replace(/\s+/g, " ")).toBe("Discuss [[Note.md]] (type: md; size: 125000 bytes)");
    expect(result).not.toContain("Use read_note");
    expect(readText).not.toHaveBeenCalled();
  });

  it.each(["mention", "wikilink"] as const)("passes a selected %s with a spaced path to read_note", async kind => {
    const { resolve, readText } = setup();
    const result = await resolve(`Discuss ${formatComposerMention("Projects/My Note.md", kind)}`, false);
    expect(result.trim().replace(/\s+/g, " ")).toBe("Discuss [[Projects/My Note.md]] (type: md; size: 125000 bytes)");
    expect(readText).not.toHaveBeenCalled();
  });

  it.each(["mention", "wikilink"] as const)("sends the body of a selected %s with a spaced path", async kind => {
    const { resolve, readText } = setup();
    const inserted = formatComposerMention("Projects/My Note.md", kind);
    expect(inserted).toBe("[[Projects/My Note.md]] ");
    const result = await resolve(`Discuss ${inserted}`);
    expect(result).toContain('--- Content of "Projects/My Note.md" ---');
    expect(result).toContain("Text from Projects/My Note.md");
    expect(readText).toHaveBeenCalledTimes(1);
  });

  it.each(["[[Note.md]]", "[[Note]]", "@Note.md", "Note.md"])("inlines %s without relying on model tools", async reference => {
    const { resolve } = setup();
    expect(await resolve(`Discuss ${reference}`)).toContain("Text from Note.md");
  });

  it("resolves aliases and headings with Obsidian's link lookup, including adjacent punctuation", async () => {
    const { resolve, lookup } = setup();
    const result = await resolve("Compare [[Projects/My Note#Ideas|My ideas]],[[Note.md]].");
    expect(result).toContain("Text from Projects/My Note.md");
    expect(result).toContain("Text from Note.md");
    expect(lookup).toHaveBeenCalledWith("Projects/My Note", "Projects/Active.md");
  });

  it("handles multiple manually typed @ paths with spaces and Unicode", async () => {
    const { resolve } = setup();
    const result = await resolve("Compare @Projects/My Note.md and @資料/計画.pdf");
    expect(result).toContain("Text from Projects/My Note.md");
    expect(result).toContain("Text from 資料/計画.pdf");
  });

  it("reads repeated references only once", async () => {
    const { resolve, readText } = setup();
    const result = await resolve("[[Note.md]] and @Note.md");
    expect(result.match(/Text from Note.md/g)).toHaveLength(2);
    expect(readText).toHaveBeenCalledTimes(1);
  });

  it("places metadata beside each repeated reference without reading contents", async () => {
    const { resolve, readText } = setup();
    const result = await resolve("[[Note]] and @Note.md", false);
    expect(result.match(/\[\[Note.md\]\] \(type:/g)).toHaveLength(2);
    expect(readText).not.toHaveBeenCalled();
  });

  it("supplies PDF size and type without extracting its text", async () => {
    const { resolve, readText } = setup();
    const result = await resolve("[[資料/計画.pdf]]", false);
    expect(result).toContain("[[資料/計画.pdf]] (type: pdf; size: 125000 bytes)");
    expect(readText).not.toHaveBeenCalled();
  });

  it("preserves unresolved links, unsupported files, and partial paths", async () => {
    const { resolve, readText } = setup();
    const input = "[[Missing]] [[image.png]] @Note.md.backup user@Note.md";
    expect(await resolve(input)).toBe(input);
    expect(readText).not.toHaveBeenCalled();
  });

  it("reports a PDF without extractable text", async () => {
    const { app } = setup();
    const { llmContent: result } = await resolveChatFileMentions(app, "[[資料/計画.pdf]]", sources, {
      inlineFileMentions: true, readMentionText: async () => null,
    });
    expect(result).toContain('[Could not extract text from "資料/計画.pdf"]');
  });

  it("preserves variable completion and expansion", async () => {
    const { app, readText } = setup();
    expect(formatComposerMention("{content}", "variable")).toBe("{content} ");
    const { llmContent: result } = await resolveChatFileMentions(app, "{selection}", {
      ...sources,
      takeExternalSelection: () => ({ text: "selected passage", sourcePath: "Note.md" }),
    }, { inlineFileMentions: true, readMentionText: readText });
    expect(result).toContain("> selected passage");
  });

  it("inlines only references outside the vault tool scope when tools are enabled", async () => {
    const { app, readText } = setup();
    const { llmContent: result } = await resolveChatFileMentions(app, "[[Projects/My Note]] and [[Note]]", sources, {
      inlineFileMentions: false,
      vaultToolAllowedFolders: ["Projects"],
      readMentionText: readText,
    });
    expect(result).toContain("Projects/My Note.md");
    expect(result).not.toContain("Text from Projects/My Note.md");
    expect(result).toContain("Text from Note.md");
    expect(readText).toHaveBeenCalledTimes(1);
    expect(result).toContain("[[Projects/My Note.md]] (type: md; size: 125000 bytes)");
    expect(result).not.toContain("[[Note.md]] (type:");
  });

  it("preserves the host's note character limit for inlined references", async () => {
    const { app, readText } = setup();
    const { llmContent: result } = await resolveChatFileMentions(app, "[[Note]]", sources, {
      inlineFileMentions: true,
      maxNoteChars: 4,
      readMentionText: readText,
    });
    expect(result).toContain("Text\n\n[Content truncated at 4 characters]");
    expect(result).not.toContain("Text from Note.md");
  });
});

describe("file reference display and model context", () => {
  it.each([false, true])("keeps multiple spaced references unchanged in the chat (inline=%s)", async inlineFileMentions => {
    const { app, readText } = setup();
    app.vault.getFiles()[2].stat.size = 8000;
    const input = "Compare [[Projects/My Note.md]] and [[資料/計画.pdf]].";
    const result = await resolveChatFileMentions(app, input, sources, {
      inlineFileMentions, readMentionText: readText,
    });
    expect(result.displayContent).toBe(input);
    expect(result.displayContent).not.toContain("size:");
    expect(result.displayContent).not.toContain("read_note");
    if (inlineFileMentions) {
      expect(result.llmContent).toContain("Text from Projects/My Note.md");
      expect(result.llmContent).toContain("Text from 資料/計画.pdf");
    } else {
      expect(result.llmContent).toContain("[[Projects/My Note.md]] (type: md; size: 125000 bytes)");
      expect(result.llmContent).toContain("[[資料/計画.pdf]] (type: pdf; size: 8000 bytes)");
      expect(result.llmContent).not.toContain("read_note");
      expect(result.llmContent).not.toContain("Text from");
      expect(readText).not.toHaveBeenCalled();
    }
  });

  it("resolves an aliased heading for the model while retaining the displayed reference", async () => {
    const { app, readText } = setup();
    const input = "Discuss [[Projects/My Note#Ideas|my ideas]].";
    const result = await resolveChatFileMentions(app, input, sources, {
      inlineFileMentions: false, readMentionText: readText,
    });
    expect(result.displayContent).toBe(input);
    expect(result.llmContent).toContain("[[Projects/My Note.md]] (type: md;");
  });

  it("consumes an external selection once and does not reinterpret its variable syntax", async () => {
    const { app, readText } = setup();
    const takeExternalSelection = vi.fn(() => ({ text: "literal {selection}", sourcePath: "Note.md" }));
    const result = await resolveChatFileMentions(app, "{selection}", {
      ...sources, takeExternalSelection,
    }, { inlineFileMentions: false, readMentionText: readText });
    expect(takeExternalSelection).toHaveBeenCalledTimes(1);
    expect(result.displayContent).toContain("> literal {selection}");
    expect(result.llmContent).toContain("> literal {selection}");
  });

  it("prepares copies for providers without changing displayed or saved messages", async () => {
    const { app, readText } = setup();
    const input = "Compare [[Projects/My Note.md]] and [[Note.md]]";
    const resolved = await resolveChatFileMentions(app, input, sources, {
      inlineFileMentions: false, readMentionText: readText,
    });
    const user = { role: "user" as const, content: resolved.displayContent, llmContent: resolved.llmContent, timestamp: 1 };
    const assistant = { role: "assistant" as const, content: "answer", timestamp: 2 };
    const history = [user, assistant];
    const modelHistory = messagesForModel(history);
    expect(modelHistory[0].content).toBe(resolved.llmContent);
    expect(modelHistory[0]).not.toBe(user);
    expect(modelHistory[1]).toBe(assistant);
    expect(history[0].content).toBe(input);
    expect(history[0].content).not.toContain("size:");
  });
});
