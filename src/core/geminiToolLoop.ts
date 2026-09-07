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
