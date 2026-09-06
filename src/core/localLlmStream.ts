/**
 * Streaming plumbing shared by the local LLM providers.
 *
 * A local server is reached over Node's http/https rather than fetch, because
 * that is what bypasses CORS inside Obsidian; these are the pieces that bridge
 * those callbacks to an async generator and decide when a silent stream counts
 * as stalled.
 */

/** Subset of `http.IncomingMessage` the providers touch. */
export interface NodeIncomingMessage {
  statusCode?: number;
  statusMessage?: string;
  on(event: "data", listener: (chunk: Uint8Array) => void): void;
  on(event: "end", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
}

/** Subset of `http.ClientRequest` the providers touch. */
export interface NodeClientRequest {
  on(event: "error", listener: (err: Error) => void): void;
  write(data: string): void;
  end(): void;
  destroy(): void;
}

/**
 * Subset of the `http`/`https` module the providers touch.
 *
 * Declared structurally rather than as `typeof import("http")` so the type
 * survives a toolchain that resolves no `@types/node` — the Obsidian plugin
 * review toolchain being one.
 */
export interface NodeHttpModule {
  request(
    options: {
      hostname: string;
      port: string;
      path: string;
      method: string;
      headers: Record<string, string>;
    },
    callback: (res: NodeIncomingMessage) => void,
  ): NodeClientRequest;
}

/** How long a stream may say nothing before it counts as stalled. */
export const STREAM_IDLE_TIMEOUT_MS = 120_000;

/** A server can be configured to be given longer than the default. */
export function getStreamIdleTimeoutMs(config: { streamIdleTimeoutSeconds?: number }): number {
  const seconds = config.streamIdleTimeoutSeconds;
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
    ? seconds * 1000
    : STREAM_IDLE_TIMEOUT_MS;
}

export function formatStreamIdleTimeoutError(timeoutMs: number): string {
  return `Stream timed out: no data received for ${timeoutMs / 1000} seconds`;
}

/**
 * Wakes an async generator that is waiting on Node event callbacks.
 *
 * The version counter is what makes it safe: a `notify()` that lands between
 * reading the version and registering the waiter is still seen, so a chunk that
 * arrives in that window cannot be mistaken for a stalled stream.
 */
export class StreamSignal {
  private version = 0;
  private resolve: (() => void) | null = null;

  /** Wake the waiting generator. Safe to call any number of times. */
  notify(): void {
    this.version++;
    const fn = this.resolve;
    this.resolve = null;
    fn?.();
  }

  /** Wait until notified, or until `timeoutMs` passes — false means timed out. */
  async wait(timeoutMs: number): Promise<boolean> {
    const vBefore = this.version;
    return new Promise<boolean>((res) => {
      const timer = setTimeout(() => { this.resolve = null; res(false); }, timeoutMs);
      this.resolve = () => { clearTimeout(timer); this.resolve = null; res(true); };
      if (this.version !== vBefore) { clearTimeout(timer); this.resolve = null; res(true); }
    });
  }
}

/**
 * Load Node's http or https module (desktop only).
 *
 * A popout window is asked first, since that is where the call comes from when
 * the chat is popped out, and the main window is the fallback for a popout that
 * was not given `require`.
 *
 * The module type is the caller's to choose: a plugin that type-checks without
 * `@types/node` takes the structural `NodeHttpModule`, one that has them can
 * ask for `typeof import("http")` and keep the full API.
 */
export function getHttpModule<T = NodeHttpModule>(protocol: string): T {
  type Loader = { require?: (id: string) => unknown; module?: { require?: (id: string) => unknown } };
  const windows: (Loader | undefined)[] = [
    typeof activeWindow !== "undefined" ? (activeWindow as unknown as Loader) : undefined,
    typeof window !== "undefined" ? (window as unknown as Loader) : undefined,
  ];
  const moduleName = protocol === "https:" ? "https" : "http";
  for (const candidate of windows) {
    const loader = candidate?.require || candidate?.module?.require;
    if (loader) return loader(moduleName) as T;
  }
  throw new Error("Node.js http module is not available in this environment");
}
