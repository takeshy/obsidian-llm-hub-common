export interface GeminiFunctionCallPlan<T> {
  remainingBefore: number;
  callsToExecute: T[];
  skippedCount: number;
  remainingAfter: number;
}

export function planGeminiFunctionCalls<T>(
  pendingCalls: T[],
  usedCalls: number,
  currentLimit: number,
): GeminiFunctionCallPlan<T> {
  const remainingBefore = Math.max(0, currentLimit - usedCalls);
  const callsToExecute = pendingCalls.slice(0, remainingBefore);
  return {
    remainingBefore,
    callsToExecute,
    skippedCount: pendingCalls.length - callsToExecute.length,
    remainingAfter: remainingBefore - callsToExecute.length,
  };
}

export interface GeminiFunctionCallLimitExtensionOptions {
  maxFunctionCalls?: number;
  requestLimitExtension?: (details: {
    used: number;
    currentLimit: number;
    extensionAmount: number;
    pendingCalls: number;
    remaining: number;
  }) => Promise<boolean | number>;
}

export async function requestGeminiFunctionCallLimitExtension(
  options: GeminiFunctionCallLimitExtensionOptions | undefined,
  defaultExtensionAmount: number,
  usedCalls: number,
  currentLimit: number,
  pendingCalls: number,
  remaining: number,
): Promise<number> {
  const extensionAmount = options?.maxFunctionCalls ?? defaultExtensionAmount;
  if (!options?.requestLimitExtension || extensionAmount <= 0) return currentLimit;
  const requested = await options.requestLimitExtension({
    used: usedCalls,
    currentLimit,
    extensionAmount,
    pendingCalls,
    remaining,
  });
  const acceptedAmount = typeof requested === "number"
    ? Math.max(0, Math.floor(requested))
    : requested ? extensionAmount : 0;
  return acceptedAmount > 0 ? currentLimit + acceptedAmount : currentLimit;
}

export interface GeminiPendingFunctionCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export class GeminiFunctionCallAccumulator {
  private pending = new Map<number, {
    id: string;
    name: string;
    argsBuffer: string;
    startArgs: Record<string, unknown>;
  }>();

  start(index: number, id: string, name: string, args: Record<string, unknown> = {}): void {
    this.pending.set(index, { id, name, argsBuffer: "", startArgs: args });
  }

  appendArguments(index: number, argumentsDelta: string): void {
    const pending = this.pending.get(index);
    if (pending) pending.argsBuffer += argumentsDelta;
  }

  finish(index: number): GeminiPendingFunctionCall | null {
    const pending = this.pending.get(index);
    if (!pending) return null;
    this.pending.delete(index);
    let args = pending.startArgs;
    if (pending.argsBuffer) {
      try {
        const parsed = JSON.parse(pending.argsBuffer) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        // Keep the complete arguments supplied by step.start.
      }
    }
    return { id: pending.id, name: pending.name, args };
  }
}

export interface GeminiFinalInteractionEvent {
  text?: string;
  interactionId?: string;
  usage?: unknown;
}

/**
 * Extract the small common subset consumed from a tool loop's final-answer
 * stream. Usage remains opaque because each host chooses the effective model
 * used to price it.
 */
export function parseGeminiFinalInteractionEvent(event: unknown): GeminiFinalInteractionEvent {
  const value = event as {
    event_type?: string;
    delta?: { type?: string; text?: unknown };
    interaction?: { id?: unknown; usage?: unknown };
  } | undefined;
  switch (value?.event_type) {
    case "step.delta":
      return value.delta?.type === "text" && typeof value.delta.text === "string"
        ? { text: value.delta.text }
        : {};
    case "interaction.created":
      return typeof value.interaction?.id === "string"
        ? { interactionId: value.interaction.id }
        : {};
    case "interaction.completed":
      return value.interaction?.usage !== undefined
        ? { usage: value.interaction.usage }
        : {};
    default:
      return {};
  }
}

export function getGeminiInteractionStatusError(status: unknown): string | null {
  if (typeof status !== "string" || status === "completed" || status === "requires_action") {
    return null;
  }
  return `Response ${status}${status === "failed" ? " (possibly blocked by safety filters)" : ""}`;
}
