import { describe, expect, it } from "vitest";
import {
  buildGeminiInteractionTools,
  messagesToGeminiContents,
} from "./geminiInteractions.js";

describe("Gemini Interactions helpers", () => {
  it("converts messages, attachments, and tool messages to Gemini contents", () => {
    expect(messagesToGeminiContents([
      {
        role: "user",
        content: "describe",
        timestamp: 1,
        attachments: [{ name: "a.png", type: "image", mimeType: "image/png", data: "base64" }],
      },
      { role: "tool", content: "result", timestamp: 2 },
    ])).toEqual([
      {
        role: "user",
        parts: [{ inlineData: { mimeType: "image/png", data: "base64" } }, { text: "describe" }],
      },
      { role: "model", parts: [{ text: "result" }] },
    ]);
  });

  it("builds nested function schemas with optional RAG and Google Search tools", () => {
    expect(buildGeminiInteractionTools([{
      name: "search",
      description: "Search",
      parameters: {
        type: "object",
        properties: {
          filters: {
            type: "object",
            description: "Filters",
            properties: {
              tags: {
                type: "array",
                description: "Tags",
                items: { type: "string", description: "Tag" },
              },
            },
            required: ["tags"],
          },
        },
        required: ["filters"],
      },
    }], {
      ragStoreIds: ["stores/example"],
      ragTopK: 8,
      ragMetadataFilter: "category = docs",
      webSearchEnabled: true,
    })).toEqual([
      {
        type: "function",
        name: "search",
        description: "Search",
        parameters: {
          type: "object",
          properties: {
            filters: {
              type: "object",
              description: "Filters",
              properties: {
                tags: {
                  type: "array",
                  description: "Tags",
                  items: { type: "string" },
                },
              },
              required: ["tags"],
            },
          },
          required: ["filters"],
        },
      },
      {
        type: "file_search",
        file_search_store_names: ["stores/example"],
        top_k: 8,
        metadata_filter: "category = docs",
      },
      { type: "google_search" },
    ]);
  });
});
