import type { Attachment, Message } from "./message.js";

/** One part of a multimodal message body. */
export type OpenAiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

/** A message in the OpenAI-compatible wire format. */
export interface OpenAiChatMessage<Arguments = string> {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null | OpenAiContentPart[];
  /** Echoed back on assistant turns; some gateways reject a thinking model without it. */
  reasoning_content?: string;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: Arguments };
  }[];
  tool_call_id?: string;
}

function dataUrl(attachment: Attachment): string {
  return `data:${attachment.mimeType};base64,${attachment.data}`;
}

/**
 * Turn the canonical chat history into the OpenAI-compatible wire format.
 *
 * The awkward parts, and why they are here rather than in a host:
 *
 * - A finished turn is stored as one assistant message that bundles its tool
 *   calls and their results, so replaying it has to be split back into an
 *   assistant tool-call turn plus one `tool` message per result. A live
 *   conversation instead keeps those `tool` messages as entries of their own,
 *   and both shapes reach this function.
 * - A call that nothing answers — an interrupted turn — keeps its text but
 *   loses its `tool_calls`: an assistant tool-call with no answering `tool`
 *   message is rejected outright by an OpenAI-compatible endpoint, which would
 *   make the next message in that chat fail rather than just lose context.
 * - A PDF read by a tool cannot be sent from the `tool` message that mentions
 *   it, because a tool result carries no file parts. Those are queued and sent
 *   as a user message just before the next turn that can hold them, deduped by
 *   path so re-reading a file does not send it twice.
 * - `llmContent` is the body the sender built for the model (inlined
 *   attachment text, workspace context); `content` is what the chat shows.
 */
export function buildOpenAiMessages(messages: Message[], systemPrompt?: string): OpenAiChatMessage[];
export function buildOpenAiMessages<Arguments>(messages: Message[], systemPrompt: string | undefined,
  encodeArguments: (args: Record<string, unknown>) => Arguments): OpenAiChatMessage<Arguments>[];
export function buildOpenAiMessages<Arguments>(messages: Message[], systemPrompt?: string,
  encodeArguments?: (args: Record<string, unknown>) => Arguments): OpenAiChatMessage<Arguments | string>[] {
  const result: OpenAiChatMessage<Arguments | string>[] = [];
  if (systemPrompt) result.push({ role: "system", content: systemPrompt });

  // A call can be answered by a `tool` message of its own further down the
  // history instead of by a result bundled into the assistant message.
  const answeredElsewhere = new Set(
    messages.filter(m => m.role === "tool" && m.toolCallId).map(m => m.toolCallId),
  );

  let pendingPdfs: Attachment[] = [];
  const queuePdfs = (attachments: Attachment[] | undefined) => {
    for (const attachment of attachments ?? []) {
      if (attachment.type !== "pdf") continue;
      const key = attachment.sourcePath ?? attachment.name;
      if (pendingPdfs.some(queued => (queued.sourcePath ?? queued.name) === key)) continue;
      pendingPdfs.push(attachment);
    }
  };
  const flushPdfs = () => {
    if (pendingPdfs.length === 0) return;
    result.push({
      role: "user",
      content: pendingPdfs.map(attachment => ({
        type: "file" as const,
        file: { filename: attachment.name, file_data: dataUrl(attachment) },
      })),
    });
    pendingPdfs = [];
  };

  for (const msg of messages) {
    const textBody = msg.llmContent ?? msg.content;

    if (msg.role === "tool") {
      result.push({ role: "tool", content: msg.content, tool_call_id: msg.toolCallId });
      queuePdfs(msg.attachments);
      continue;
    }

    const resultsByCallId = new Map((msg.toolResults ?? []).map(r => [r.toolCallId, r]));
    const answeredCalls = (msg.toolCalls ?? [])
      .filter(call => resultsByCallId.has(call.id) || answeredElsewhere.has(call.id));
    if (msg.role === "assistant" && answeredCalls.length > 0) {
      flushPdfs();
      const bundled = answeredCalls.filter(call => resultsByCallId.has(call.id));
      result.push({
        role: "assistant",
        // An OpenAI-compatible server expects a tool-only assistant turn to say
        // null rather than an empty string, which matters most where llama.cpp
        // renders the turn through a model-specific template. The text of a
        // bundled turn is sent after its results instead, in order.
        content: bundled.length > 0 ? null : (textBody || null),
        ...(msg.thinking ? { reasoning_content: msg.thinking } : {}),
        tool_calls: answeredCalls.map(call => ({
          id: call.id,
          type: "function" as const,
          function: { name: call.name, arguments: encodeArguments ? encodeArguments(call.args) : JSON.stringify(call.args) },
        })),
      });
      for (const call of bundled) {
        const answer = resultsByCallId.get(call.id)!;
        result.push({
          role: "tool",
          content: typeof answer.result === "string" ? answer.result : JSON.stringify(answer.result),
          tool_call_id: call.id,
        });
        // Re-attach a PDF read in an earlier turn, or the replayed result
        // claims a document the model can no longer see.
        queuePdfs(answer.attachments);
      }
      if (bundled.length > 0 && textBody) {
        flushPdfs();
        result.push({ role: "assistant", content: textBody });
      }
      continue;
    }

    flushPdfs();
    const multimodal = msg.role === "user"
      ? (msg.attachments ?? []).filter(a => a.type === "image" || a.type === "pdf")
      : [];
    if (multimodal.length > 0) {
      result.push({
        role: "user",
        content: [
          { type: "text", text: textBody },
          ...multimodal.map((attachment): OpenAiContentPart => attachment.type === "image"
            ? { type: "image_url", image_url: { url: dataUrl(attachment) } }
            : { type: "file", file: { filename: attachment.name, file_data: dataUrl(attachment) } }),
        ],
      });
      continue;
    }

    result.push({
      role: msg.role === "user" ? "user" : "assistant",
      content: textBody,
      ...(msg.role === "assistant" && msg.thinking ? { reasoning_content: msg.thinking } : {}),
    });
  }
  flushPdfs();

  return result;
}
