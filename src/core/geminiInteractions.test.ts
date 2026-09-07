import { describe, expect, it } from "vitest";
import {
  buildGeminiHistoryReplayInput,
  buildGeminiInteractionInput,
  buildGeminiGenerateContentTools,
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

  it("builds multimodal Interactions input and decodes text attachments", () => {
    expect(buildGeminiInteractionInput({
      role: "user",
      content: "question",
      timestamp: 1,
      attachments: [
        { name: "a.png", type: "image", mimeType: "image/png", data: "image-data" },
        { name: "a.pdf", type: "pdf", mimeType: "application/pdf", data: "pdf-data" },
        { name: "notes.txt", type: "text", mimeType: "text/plain", data: btoa("notes") },
      ],
    })).toEqual([
      { type: "image", data: "image-data", mime_type: "image/png" },
      { type: "document", data: "pdf-data", mime_type: "application/pdf" },
      { type: "text", text: "[File: notes.txt]\nnotes" },
      { type: "text", text: "question" },
    ]);
  });

  it("replays history as a transcript while preserving current attachments", () => {
    expect(buildGeminiHistoryReplayInput([
      { role: "user", content: "first", timestamp: 1 },
      { role: "assistant", content: "answer", timestamp: 2 },
      {
        role: "user",
        content: "follow-up",
        timestamp: 3,
        attachments: [{ name: "audio.mp3", type: "audio", mimeType: "audio/mpeg", data: "audio-data" }],
      },
    ])).toEqual([
      { type: "text", text: "[Previous conversation]\nUser: first\n\nAssistant: answer\n\n[Current message]\n" },
      { type: "audio", data: "audio-data", mime_type: "audio/mpeg" },
      { type: "text", text: "follow-up" },
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

  it("builds GenerateContent declarations with uppercase schema types", () => {
    expect(buildGeminiGenerateContentTools([{
      name: "search",
      description: "Search",
      parameters: {
        type: "object",
        properties: {
          queries: {
            type: "array",
            description: "Queries",
            items: {
              type: "object",
              description: "Query",
              properties: {
                text: { type: "string", description: "Text" },
              },
              required: ["text"],
            },
          },
        },
        required: ["queries"],
      },
    }], true)).toEqual([
      {
        functionDeclarations: [{
          name: "search",
          description: "Search",
          parameters: {
            type: "OBJECT",
            properties: {
              queries: {
                type: "ARRAY",
                description: "Queries",
                enum: undefined,
                items: {
                  type: "OBJECT",
                  properties: {
                    text: {
                      type: "STRING",
                      description: "Text",
                      enum: undefined,
                    },
                  },
                  required: ["text"],
                },
              },
            },
            required: ["queries"],
          },
        }],
      },
      { googleSearch: {} },
    ]);
    expect(buildGeminiGenerateContentTools([], false)).toBeUndefined();
  });
});
