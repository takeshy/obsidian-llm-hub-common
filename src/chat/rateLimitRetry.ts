import { isRetryableRateLimitError, sleep } from "./chatUtils.js";

export interface RateLimitRetryOptions {
  /** How long to wait before each retry. Empty means do not retry at all. */
  delays: readonly number[];
  /** Whether the user has stopped the run; retrying a stopped run is pointless. */
  isAborted: () => boolean;
  /**
   * Runs before each wait: the failed attempt left partial output on screen,
   * and the user is told how long the next try is away.
   */
  onRetry: (info: { attempt: number; total: number; delayMs: number }) => void;
  /** Overridable for tests; the default checks cancellation at most every 100 ms. */
  wait?: (ms: number) => Promise<unknown>;
}

/**
 * Run a streaming attempt, retrying it while the provider is rate-limiting us.
 *
 * Only short-lived limits are retried. A daily or monthly allowance, a billing
 * problem or an exhausted project quota comes back as the same 429 every time,
 * so retrying it just adds the whole delay schedule to the wait before the user
 * sees the explanation the provider actually sent.
 *
 * Returns "aborted" when the user stopped the run, so the caller can leave the
 * message where it is instead of reporting a failure.
 */
export async function withRateLimitRetry(
  run: () => Promise<void>,
  { delays, isAborted, onRetry, wait }: RateLimitRetryOptions,
): Promise<"done" | "aborted"> {
  let attempt = 0;
  for (;;) {
    if (isAborted()) return "aborted";
    try {
      await run();
      return "done";
    } catch (error) {
      if (isAborted()) return "aborted";
      if (!isRetryableRateLimitError(error) || attempt >= delays.length) throw error;
      const delayMs = delays[attempt];
      attempt += 1;
      onRetry({ attempt, total: delays.length, delayMs });
      if (wait) {
        await wait(delayMs);
      } else {
        const deadline = Date.now() + delayMs;
        while (!isAborted() && Date.now() < deadline) {
          await sleep(Math.min(100, deadline - Date.now()));
        }
      }
    }
  }
}
