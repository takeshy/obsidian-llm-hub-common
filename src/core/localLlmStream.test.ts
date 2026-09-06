import { describe, expect, it } from "vitest";
import {
  formatStreamIdleTimeoutError,
  getStreamIdleTimeoutMs,
  STREAM_IDLE_TIMEOUT_MS,
  StreamSignal,
} from "./localLlmStream.js";

describe("getStreamIdleTimeoutMs", () => {
  it("uses the configured number of seconds", () => {
    expect(getStreamIdleTimeoutMs({ streamIdleTimeoutSeconds: 30 })).toBe(30_000);
  });

  it("falls back to the default for anything unusable", () => {
    // A slow local model must not be cut off because a setting was left blank
    // or saved as 0.
    for (const seconds of [undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(getStreamIdleTimeoutMs({ streamIdleTimeoutSeconds: seconds })).toBe(STREAM_IDLE_TIMEOUT_MS);
    }
  });

  it("says how long it waited", () => {
    expect(formatStreamIdleTimeoutError(90_000)).toBe("Stream timed out: no data received for 90 seconds");
  });
});

describe("StreamSignal", () => {
  it("wakes a waiter", async () => {
    const signal = new StreamSignal();
    const waited = signal.wait(1000);
    signal.notify();
    expect(await waited).toBe(true);
  });

  it("reports a timeout when nothing arrives", async () => {
    expect(await new StreamSignal().wait(1)).toBe(false);
  });

  it("only wakes a waiter that is already waiting", async () => {
    // The signal is a wake-up, not a queue: a notify with nobody waiting is
    // dropped. Callers must decide they have to wait by looking at their own
    // buffer, never by counting notifications.
    const signal = new StreamSignal();
    signal.notify();
    expect(await signal.wait(1)).toBe(false);
  });

  it("can be woken again after a timeout", async () => {
    const signal = new StreamSignal();
    expect(await signal.wait(1)).toBe(false);
    const waited = signal.wait(1000);
    signal.notify();
    expect(await waited).toBe(true);
  });
});
