import type { Message, RagContext } from "./message.js";
import type { ToolDefinition, ToolPropertyDefinition } from "./provider.js";

export interface GeminiContentPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiContentPart[];
}

export type GeminiInteractionTool =
  | {
    type: "function";
    name: string;
    description: string;
    parameters: unknown;
  }
  | {
    type: "file_search";
    file_search_store_names: string[];
    top_k?: number;
    metadata_filter?: string;
  }
  | { type: "google_search" };

export interface GeminiInteractionToolOptions {
  ragStoreIds?: string[];
  ragTopK?: number;
  ragMetadataFilter?: string;
  webSearchEnabled?: boolean;
}

export type GeminiInteractionContent =
  | { type: "text"; text: string }
  | { type: "image" | "audio" | "video" | "document"; data: string; mime_type: string };

export interface GeminiGenerateContentSchema {
  type: string;
  description?: string;
  enum?: string[];
  items?: GeminiGenerateContentSchema;
  properties?: Record<string, GeminiGenerateContentSchema>;
  required?: string[];
}

export type GeminiGenerateContentTool =
  | {
    functionDeclarations: Array<{
      name: string;
      description: string;
      parameters: GeminiGenerateContentSchema;
    }>;
  }
  | { googleSearch: Record<string, never> };

export interface GeminiRagRequest {
  parts: GeminiContentPart[];
  tools: Array<{
    fileSearch: {
      fileSearchStoreNames: string[];
      topK: number;
      metadataFilter?: string;
    };
  }>;
}

export interface GeminiInteractionSourceCollection {
  sources: string[];
  contexts: RagContext[];
}

type GeminiInteractionAnnotationLike = {
  source?: string;
  url?: string;
  file_name?: string;
  document_uri?: string;
  name?: string;
  place_id?: string;
};

function appendUniqueGeminiSource(sources: string[], source: string): void {
  if (source && !sources.includes(source)) sources.push(source);
}

/** Collect citation labels emitted by an Interactions text_annotation_delta. */
export function collectGeminiInteractionAnnotationSources(
  sources: string[],
  annotations: unknown,
): void {
  if (!Array.isArray(annotations)) return;
  for (const annotation of annotations as GeminiInteractionAnnotationLike[]) {
    const source = String(
      annotation?.url ??
      annotation?.file_name ??
      annotation?.document_uri ??
      annotation?.name ??
      annotation?.place_id ??
      annotation?.source ??
      "",
    ).trim();
    appendUniqueGeminiSource(sources, source);
  }
}

/** Collect one streamed File Search result and its bounded display excerpt. */
export function collectGeminiInteractionFileSearchResult(
  collection: GeminiInteractionSourceCollection,
  raw: unknown,
): void {
  const result = raw as { title?: string; text?: string } | undefined;
  const source = String(result?.title ?? "").trim();
  appendUniqueGeminiSource(collection.sources, source);
  const normalizedText = String(result?.text ?? "").replace(/\s+/g, " ").trim();
  if (!source || !normalizedText) return;
  const text = normalizedText.length > 500
    ? normalizedText.slice(0, 500) + "..."
    : normalizedText;
  if (!collection.contexts.some(context => context.source === source && context.text === text)) {
    collection.contexts.push({ source, text });
  }
}

/** Fallback source collection for completed/non-streaming Interactions step payloads. */
export function collectGeminiInteractionStepSources(
  collection: GeminiInteractionSourceCollection,
  steps: unknown,
): void {
  if (!Array.isArray(steps)) return;
  for (const step of steps as Array<{ type?: string; content?: unknown[]; result?: unknown[] }>) {
    if (step?.type === "file_search_result" && Array.isArray(step.result)) {
      for (const result of step.result) collectGeminiInteractionFileSearchResult(collection, result);
    }
    if (step?.type !== "model_output" || !Array.isArray(step.content)) continue;
    for (const content of step.content as Array<{
      type?: string;
      result?: unknown[];
      annotations?: unknown;
    }>) {
      // Kept for compatibility with legacy-shaped payloads where results were content.
      if (content?.type === "file_search_result" && Array.isArray(content.result)) {
        for (const result of content.result) collectGeminiInteractionFileSearchResult(collection, result);
      }
      if (content?.type === "text") {
        collectGeminiInteractionAnnotationSources(collection.sources, content.annotations);
      }
    }
  }
}

export function buildGeminiMessageParts(message: Message): GeminiContentPart[] {
  const parts: GeminiContentPart[] = [];
  for (const attachment of message.attachments ?? []) {
    parts.push({
      inlineData: {
        mimeType: attachment.mimeType,
        data: attachment.data,
      },
    });
  }
  if (message.content) parts.push({ text: message.content });
  return parts;
}

export function messagesToGeminiContents(messages: Message[]): GeminiContent[] {
  return messages.map(message => ({
    role: message.role === "user" ? "user" : "model",
    parts: buildGeminiMessageParts(message),
  }));
}

export function buildGeminiInteractionInput(message: Message): string | GeminiInteractionContent[] {
  if (!message.attachments?.length) return message.content || "";

  const contents: GeminiInteractionContent[] = [];
  for (const attachment of message.attachments) {
    const type = attachment.type === "pdf" ? "document" : attachment.type;
    if (type === "image" || type === "audio" || type === "video" || type === "document") {
      contents.push({ type, data: attachment.data, mime_type: attachment.mimeType });
    } else if (attachment.data) {
      try {
        contents.push({ type: "text", text: `[File: ${attachment.name}]\n${atob(attachment.data)}` });
      } catch {
        contents.push({ type: "text", text: `[File: ${attachment.name}]` });
      }
    }
  }
  if (message.content) contents.push({ type: "text", text: message.content });
  return contents;
}

export function buildGeminiHistoryReplayInput(
  messages: Message[],
): string | GeminiInteractionContent[] {
  const historyMessages = messages.slice(0, -1);
  const lastMessage = messages[messages.length - 1];
  if (historyMessages.length === 0) return buildGeminiInteractionInput(lastMessage);

  const lines: string[] = [];
  for (const message of historyMessages) {
    const role = message.role === "user" ? "User" : "Assistant";
    if (message.content) lines.push(`${role}: ${message.content}`);
  }
  const historyText = `[Previous conversation]\n${lines.join("\n\n")}\n\n[Current message]\n`;
  if (!lastMessage.attachments?.length) return historyText + (lastMessage.content || "");

  const contents: GeminiInteractionContent[] = [{ type: "text", text: historyText }];
  const lastParts = buildGeminiInteractionInput(lastMessage);
  if (Array.isArray(lastParts)) contents.push(...lastParts);
  else contents.push({ type: "text", text: lastParts });
  return contents;
}

export function buildGeminiRagRequest(
  userMessage: string,
  ragStoreIds: string[],
  topK: number,
  metadataFilter?: string,
  attachments?: Message["attachments"],
): GeminiRagRequest {
  const parts: GeminiContentPart[] = [];
  for (const attachment of attachments ?? []) {
    parts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.data } });
  }
  if (userMessage || !attachments?.length) parts.push({ text: userMessage });
  return {
    parts,
    tools: [{
      fileSearch: {
        fileSearchStoreNames: ragStoreIds,
        topK,
        ...(metadataFilter ? { metadataFilter } : {}),
      },
    }],
  };
}

export function extractGeminiRagContexts(response: unknown): {
  sources: string[];
  contexts: RagContext[];
} {
  const candidates = (response as {
    candidates?: Array<{
      groundingMetadata?: {
        groundingChunks?: Array<{
          retrievedContext?: { title?: string; text?: string; uri?: string };
        }>;
      };
    }>;
  } | undefined)?.candidates;
  const chunks = candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const sources: string[] = [];
  const contexts: RagContext[] = [];
  for (const chunk of chunks) {
    const retrieved = chunk.retrievedContext;
    if (!retrieved) continue;
    const source = String(retrieved.title ?? retrieved.uri ?? "").trim();
    if (!source) continue;
    if (!sources.includes(source)) sources.push(source);
    const normalizedText = String(retrieved.text ?? "").replace(/\s+/g, " ").trim();
    if (!normalizedText) continue;
    const text = normalizedText.length > 500 ? normalizedText.slice(0, 500) + "..." : normalizedText;
    if (!contexts.some(context => context.source === source && context.text === text)) {
      contexts.push({ source, text });
    }
  }
  return { sources, contexts };
}

function geminiToolPropertyToJsonSchema(property: ToolPropertyDefinition): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    type: property.type,
    description: property.description,
  };
  if (property.enum) schema.enum = property.enum;
  if (property.type === "array" && property.items) {
    const items = property.items;
    if (items.type === "object" && items.properties) {
      schema.items = {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(items.properties).map(([key, value]) => [key, geminiToolPropertyToJsonSchema(value)]),
        ),
        required: items.required,
      };
    } else {
      schema.items = { type: items.type };
    }
  }
  if (property.type === "object" && property.properties) {
    schema.properties = Object.fromEntries(
      Object.entries(property.properties).map(([key, value]) => [key, geminiToolPropertyToJsonSchema(value)]),
    );
    if (property.required?.length) schema.required = property.required;
  }
  return schema;
}

export function geminiToolParametersToJsonSchema(parameters: ToolDefinition["parameters"]): unknown {
  return {
    type: "object",
    properties: Object.fromEntries(
      Object.entries(parameters.properties).map(([key, value]) => [key, geminiToolPropertyToJsonSchema(value)]),
    ),
    required: parameters.required,
  };
}

export function buildGeminiInteractionTools(
  tools: ToolDefinition[],
  options: GeminiInteractionToolOptions = {},
): GeminiInteractionTool[] {
  const result: GeminiInteractionTool[] = tools.map(tool => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: geminiToolParametersToJsonSchema(tool.parameters),
  }));
  if (options.ragStoreIds?.length) {
    result.push({
      type: "file_search",
      file_search_store_names: options.ragStoreIds,
      top_k: options.ragTopK,
      ...(options.ragMetadataFilter ? { metadata_filter: options.ragMetadataFilter } : {}),
    });
  }
  if (options.webSearchEnabled) result.push({ type: "google_search" });
  return result;
}

function geminiToolPropertyToGenerateContentSchema(
  property: ToolPropertyDefinition,
): GeminiGenerateContentSchema {
  const schema: GeminiGenerateContentSchema = {
    type: property.type.toUpperCase(),
    description: property.description,
    enum: property.enum,
  };
  if (property.type === "array" && property.items) {
    const items = property.items;
    schema.items = items.type === "object" && items.properties
      ? {
        type: "OBJECT",
        properties: Object.fromEntries(
          Object.entries(items.properties).map(([key, value]) => [
            key,
            geminiToolPropertyToGenerateContentSchema(value),
          ]),
        ),
        required: items.required,
      }
      : { type: items.type.toUpperCase() };
  }
  if (property.type === "object" && property.properties) {
    schema.properties = Object.fromEntries(
      Object.entries(property.properties).map(([key, value]) => [
        key,
        geminiToolPropertyToGenerateContentSchema(value),
      ]),
    );
    if (property.required?.length) schema.required = property.required;
  }
  return schema;
}

export function buildGeminiGenerateContentTools(
  tools: ToolDefinition[],
  webSearchEnabled = false,
): GeminiGenerateContentTool[] | undefined {
  const result: GeminiGenerateContentTool[] = [];
  if (tools.length > 0) {
    result.push({
      functionDeclarations: tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "OBJECT",
          properties: Object.fromEntries(
            Object.entries(tool.parameters.properties).map(([key, value]) => [
              key,
              geminiToolPropertyToGenerateContentSchema(value),
            ]),
          ),
          required: tool.parameters.required,
        },
      })),
    });
  }
  if (webSearchEnabled) result.push({ googleSearch: {} });
  return result.length > 0 ? result : undefined;
}
