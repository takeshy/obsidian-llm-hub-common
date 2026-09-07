import type { Message } from "./message.js";
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
