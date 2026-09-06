import type { StreamChunk } from "./provider.js";

/**
 * Split streamed content into visible text and reasoning at `<think>` tags.
 *
 * Models that have no separate reasoning channel (Qwen, DeepSeek, MiniMax and
 * others) put their reasoning inline in the content, so the tags have to be
 * found in a stream that can cut a tag in half at any point. `inThinkTag` and
 * `tagBuffer` carry that state between calls: pass back what the previous call
 * returned, and hand the leftover buffer nowhere else — anything held in it has
 * not been emitted yet.
 */
export function parseThinkTags(
  content: string,
  inThinkTag: boolean,
  tagBuffer: string,
): { items: StreamChunk[]; inThinkTag: boolean; tagBuffer: string } {
  const items: StreamChunk[] = [];
  let text = tagBuffer + content;
  tagBuffer = "";

  while (text.length > 0) {
    if (!inThinkTag) {
      const openIdx = text.indexOf("<think>");
      if (openIdx !== -1) {
        if (openIdx > 0) {
          items.push({ type: "text", content: text.slice(0, openIdx) });
        }
        inThinkTag = true;
        text = text.slice(openIdx + 7);
      } else {
        const partial = getPartialTagMatch(text, "<think>");
        if (partial > 0) {
          const safe = text.slice(0, text.length - partial);
          if (safe) items.push({ type: "text", content: safe });
          tagBuffer = text.slice(text.length - partial);
          text = "";
        } else {
          items.push({ type: "text", content: text });
          text = "";
        }
      }
    } else {
      const closeIdx = text.indexOf("</think>");
      if (closeIdx !== -1) {
        if (closeIdx > 0) {
          items.push({ type: "thinking", content: text.slice(0, closeIdx) });
        }
        inThinkTag = false;
        text = text.slice(closeIdx + 8);
      } else {
        const partial = getPartialTagMatch(text, "</think>");
        if (partial > 0) {
          const safe = text.slice(0, text.length - partial);
          if (safe) items.push({ type: "thinking", content: safe });
          tagBuffer = text.slice(text.length - partial);
          text = "";
        } else {
          items.push({ type: "thinking", content: text });
          text = "";
        }
      }
    }
  }

  return { items, inThinkTag, tagBuffer };
}

/** How many characters at the end of `text` are a prefix of `tag` (0 if none). */
function getPartialTagMatch(text: string, tag: string): number {
  const maxCheck = Math.min(text.length, tag.length - 1);
  for (let len = maxCheck; len > 0; len--) {
    if (text.endsWith(tag.slice(0, len))) {
      return len;
    }
  }
  return 0;
}
