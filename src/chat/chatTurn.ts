import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Message } from "../core/message.js";
import { tracing } from "../core/tracingHooks.js";
import type { StreamSession } from "./useChatStreamSessions.js";

/** The chat view state a turn moves while it runs. */
export interface ChatTurnUi {
  /** The conversation as it stands before this turn, captured when the send began. */
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setStreamingContent: Dispatch<SetStateAction<string>>;
  setStreamingThinking: Dispatch<SetStateAction<string>>;
  abortControllerRef: MutableRefObject<AbortController | null>;
  createStreamSession: () => StreamSession;
  /** What a failed turn shows the user; hosts word this differently. */
  describeError: (error: unknown) => string;
}

/** What a turn hands to the work it is running. */
export interface ChatTurn {
  session: StreamSession;
  abortController: AbortController;
  traceId: string | null;
  /** False once the user moved to another chat: this turn no longer owns the view. */
  isActive: () => boolean;
  userMessage: Message;
}

export interface ChatTurnOutcome {
  /** Appended to the chat and saved. Null leaves the chat untouched — an abandoned attempt. */
  message: Message | null;
  /** Traced instead of the message's own content. */
  output?: string;
  metadata?: Record<string, unknown>;
  /** Defaults to a completed turn, or to an abandoned one when there is no message. */
  status?: { value: number; comment: string };
}

export interface ChatTurnStart<C> {
  /** How the message reads in the chat; only the host knows that. */
  userMessage: Message;
  trace: { name: string; input?: unknown; sessionId?: string; metadata?: Record<string, unknown> };
  /** Whatever the preparation worked out that the rest of the turn needs. */
  context?: C;
}

export interface ChatTurnRequest<C> {
  /**
   * Resolve what the user typed and say how the message reads. Returning null
   * calls the send off, leaving the chat as it was — a host that finds it has
   * no client to talk to says so here.
   */
  prepare: () => Promise<ChatTurnStart<C> | null> | ChatTurnStart<C> | null;
  /** Builds the request and runs the provider. Throwing here is how a turn fails. */
  run: (turn: ChatTurn, context: C) => Promise<ChatTurnOutcome | Message>;
  /** Called after a finished turn was saved, and only while it still owns the view. */
  onSaved?: (turn: ChatTurn, context: C) => void;
  /** Host teardown. Runs however the turn ended, and finishes before the view is released. */
  onSettled?: (turn: ChatTurn, context: C) => void | Promise<void>;
}

const COMPLETED = { value: 1, comment: "completed" };
const ABANDONED = { value: 0.5, comment: "abandoned" };

/**
 * Run one exchange: put the user's message up, run the host's work, save what came
 * back, and let the view go again.
 *
 * The point of doing this here is the exits. A turn can finish, fail, or be
 * abandoned partway, and each of those has to append to the same history, close
 * the same trace and release the same stream — a send path that spells them out
 * itself has three places to forget one of those, which is how a stopped turn
 * ends up saved without its user message, or a failed one leaves the composer
 * spinning. The host is left with the part that is actually its own: building
 * the request and running the provider.
 */
export async function runChatTurn<C = void>(ui: ChatTurnUi, request: ChatTurnRequest<C>): Promise<void> {
  // Both of these have to be read before anything awaits. Resolving what the
  // user typed takes a turn of the event loop, and if the session were opened
  // after it, a chat switch in that window would send the answer to whichever
  // chat the user had just opened instead of the one they typed in.
  const session = ui.createStreamSession();
  const history = ui.messages;

  const start = await request.prepare();
  if (!start) return;
  const { userMessage } = start;
  const context = start.context as C;

  ui.setMessages(prev => [...prev, userMessage]);
  ui.setIsLoading(true);
  ui.setStreamingContent("");
  ui.setStreamingThinking("");

  const abortController = new AbortController();
  ui.abortControllerRef.current = abortController;

  const traceId = tracing.traceStart(start.trace.name, {
    sessionId: start.trace.sessionId ?? session.myChatId,
    input: start.trace.input,
    metadata: start.trace.metadata,
  });

  const turn: ChatTurn = {
    session,
    abortController,
    traceId,
    isActive: session.isActive,
    userMessage,
  };

  try {
    const result = await request.run(turn, context);
    const outcome: ChatTurnOutcome = "role" in result ? { message: result } : result;

    if (outcome.message) {
      await session.saveResult([...history, userMessage, outcome.message]);
      tracing.traceEnd(traceId, {
        output: outcome.output ?? outcome.message.content,
        metadata: outcome.metadata,
      });
      tracing.score(traceId, { name: "status", ...(outcome.status ?? COMPLETED) });
      if (session.isActive()) request.onSaved?.(turn, context);
    } else {
      tracing.traceEnd(traceId, { output: outcome.output, metadata: outcome.metadata });
      tracing.score(traceId, { name: "status", ...(outcome.status ?? ABANDONED) });
    }
  } catch (error) {
    const text = ui.describeError(error);
    await session.saveResult([
      ...history,
      userMessage,
      { role: "assistant", content: text, timestamp: Date.now() },
    ]);
    tracing.traceEnd(traceId, { output: text, metadata: { error: true } });
    tracing.score(traceId, { name: "status", value: 0, comment: text });
  } finally {
    await request.onSettled?.(turn, context);
    session.cleanup(abortController);
  }
}
