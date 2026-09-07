import { describe, expect, it, vi } from "vitest";
import { withRateLimitRetry } from "./rateLimitRetry.js";

const rateLimited = (message = "429 Too Many Requests") => Object.assign(new Error(message), { status: 429 });

function harness(overrides: Partial<Parameters<typeof withRateLimitRetry>[1]> = {}) {
  const waits: number[] = [];
  const notices: { attempt: number; total: number; delayMs: number }[] = [];
  return {
    waits,
    notices,
    options: {
      delays: [10, 30, 60],
      isAborted: () => false,
      onRetry: (info: { attempt: number; total: number; delayMs: number }) => { notices.push(info); },
      wait: async (ms: number) => { waits.push(ms); },
      ...overrides,
    },
  };
}

describe("withRateLimitRetry", () => {
  it("does not retry when stopped during backoff", async () => {
    let aborted = false;
    const { options } = harness({ isAborted: () => aborted, wait: async () => { aborted = true; } });
    const run = vi.fn().mockRejectedValueOnce(rateLimited()).mockResolvedValue(undefined);
    expect(await withRateLimitRetry(run, options)).toBe("aborted");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("ends the default backoff promptly when stopped", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    try {
      let aborted = false;
      const run = vi.fn(async () => { throw rateLimited(); });
      const pending = withRateLimitRetry(run, {
        delays: [60_000], isAborted: () => aborted, onRetry: () => {},
      });
      await vi.advanceTimersByTimeAsync(1);
      aborted = true;
      await vi.advanceTimersByTimeAsync(100);
      expect(await pending).toBe("aborted");
      expect(run).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
  it("returns as soon as an attempt succeeds", async () => {
    const { options, waits } = harness();
    const run = vi.fn(async () => {});
    expect(await withRateLimitRetry(run, options)).toBe("done");
    expect(run).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it("waits the schedule in order and tells the caller each time", async () => {
    const { options, waits, notices } = harness();
    let calls = 0;
    const run = vi.fn(async () => { if (++calls < 3) throw rateLimited(); });

    expect(await withRateLimitRetry(run, options)).toBe("done");
    expect(waits).toEqual([10, 30]);
    expect(notices).toEqual([
      { attempt: 1, total: 3, delayMs: 10 },
      { attempt: 2, total: 3, delayMs: 30 },
    ]);
  });

  it("gives up once the schedule runs out", async () => {
    const { options, waits } = harness();
    const run = vi.fn(async () => { throw rateLimited(); });

    await expect(withRateLimitRetry(run, options)).rejects.toThrow("429");
    expect(run).toHaveBeenCalledTimes(4);
    expect(waits).toEqual([10, 30, 60]);
  });

  it("does not retry a quota that will answer the same way every time", async () => {
    // Retrying a daily allowance adds the whole schedule to the wait before the
    // user sees what the provider actually said.
    const { options, waits } = harness();
    const run = vi.fn(async () => { throw rateLimited("429: Requests per day quota exceeded"); });

    await expect(withRateLimitRetry(run, options)).rejects.toThrow(/per day/);
    expect(run).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it("rethrows anything that is not a rate limit", async () => {
    const { options } = harness();
    const run = vi.fn(async () => { throw new Error("network down"); });

    await expect(withRateLimitRetry(run, options)).rejects.toThrow("network down");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("reports an abort instead of retrying or failing", async () => {
    const { options, waits } = harness({ isAborted: () => true });
    const run = vi.fn(async () => { throw rateLimited(); });

    expect(await withRateLimitRetry(run, options)).toBe("aborted");
    expect(waits).toEqual([]);
  });

  it("does not retry at all when the host gives no schedule", async () => {
    const { options, waits } = harness({ delays: [] });
    const run = vi.fn(async () => { throw rateLimited(); });

    await expect(withRateLimitRetry(run, options)).rejects.toThrow("429");
    expect(run).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });
});
