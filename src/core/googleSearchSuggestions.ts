import type { StreamChunk } from "./provider.js";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
/** Only documented API display fields are accepted; arbitrary tool results are not HTML. */
export function extractGoogleSearchSuggestions(raw: unknown): string[] {
  const found = new Set<string>();
  const add = (value: unknown) => { if (typeof value === "string" && value.trim()) found.add(value); };
  const visit = (value: unknown) => {
    const item = record(value);
    for (const candidate of Array.isArray(item.candidates) ? item.candidates : []) {
      add(record(record(record(candidate).groundingMetadata).searchEntryPoint).renderedContent);
    }
    if (item.type === "google_search_result") {
      for (const result of Array.isArray(item.result) ? item.result : []) add(record(result).search_suggestions);
    }
    if (item.event_type === "step.delta") visit(item.delta);
    if (item.event_type === "step.start") visit(item.step);
    if (item.event_type === "interaction.completed") {
      const interaction = record(item.interaction);
      for (const step of Array.isArray(interaction.steps) ? interaction.steps : []) visit(step);
    }
  };
  visit(raw);
  return [...found];
}

/** Do not reveal a grounded answer until its required display data is available. */
export async function* withGoogleSearchSuggestions(stream: AsyncIterable<StreamChunk>): AsyncGenerator<StreamChunk> {
  const buffered: StreamChunk[] = [];
  const suggestions = new Set<string>();
  let used = false;
  for await (const chunk of stream) {
    if (chunk.type === "error") { yield chunk; return; }
    if (chunk.type === "web_search_used") used = true;
    for (const html of chunk.searchSuggestions ?? []) suggestions.add(html);
    if (chunk.type === "done") {
      if (used && suggestions.size === 0) {
        yield { type: "error", error: "Google Search did not return Search Suggestions. The grounded answer cannot be displayed. Use external Web search or try again." };
        return;
      }
      if (suggestions.size) yield { type: "search_suggestions", searchSuggestions: [...suggestions] };
      for (const pending of buffered) yield pending;
      yield { ...chunk, googleSearchGrounding: used || undefined, searchSuggestions: suggestions.size ? [...suggestions] : undefined };
      return;
    }
    if (chunk.type === "text" || chunk.type === "replace_text" || chunk.type === "thinking" || chunk.type === "image_generated") buffered.push(chunk);
    else if (chunk.type !== "search_suggestions") yield chunk;
  }
}
