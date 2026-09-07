import { formatError } from "./error.js";
import { formatStreamIdleTimeoutError, getHttpModule, StreamSignal, type NodeHttpModule, type NodeClientRequest } from "./localLlmStream.js";

/** Stream decoded lines with shared HTTP status, UTF-8, abort, timeout and cleanup handling. */
export async function* streamLocalLlmLines(options: {
  url: URL;
  body: string;
  headers: Record<string, string>;
  signal?: AbortSignal;
  idleTimeoutMs: number;
  http?: NodeHttpModule;
}): AsyncGenerator<string> {
  if (options.signal?.aborted) return;
  const http = options.http ?? getHttpModule<NodeHttpModule>(options.url.protocol);
  const queue: string[] = [];
  const wake = new StreamSignal();
  let done = false;
  let failure: Error | undefined;
  let req: NodeClientRequest | undefined;
  const fail = (error: unknown) => {
    if (done) return;
    failure = new Error(`Connection failed: ${formatError(error)}`);
    done = true;
    wake.notify();
  };
  const onAbort = () => { done = true; req?.destroy(); wake.notify(); };
  try {
    req = http.request({
      hostname: options.url.hostname, port: options.url.port,
      path: options.url.pathname + options.url.search, method: "POST",
      headers: { ...options.headers, "Content-Length": String(new TextEncoder().encode(options.body).byteLength) },
    }, res => {
      const decoder = new TextDecoder();
      const failedStatus = res.statusCode !== undefined && (res.statusCode < 200 || res.statusCode >= 300);
      let buffer = "";
      const decode = (text: string, end = false) => {
        if (failedStatus) {
          buffer = (buffer + text).slice(0, 200);
        } else {
          buffer += text;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          queue.push(...lines);
          if (end && buffer) { queue.push(buffer); buffer = ""; }
        }
      };
      res.on("data", chunk => {
        if (done) return;
        decode(decoder.decode(chunk, { stream: true }));
        wake.notify();
      });
      res.on("end", () => {
        if (done) return;
        decode(decoder.decode(), true);
        if (failedStatus) failure = new Error(`HTTP ${res.statusCode}: ${buffer || res.statusMessage}`);
        done = true;
        wake.notify();
      });
      res.on("error", fail);
    });
    req.on("error", fail);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) { onAbort(); return; }
    req.write(options.body);
    req.end();
    while (true) {
      if (options.signal?.aborted) return;
      if (queue.length > 0) { yield queue.shift()!; continue; }
      if (failure) throw failure;
      if (done) return;
      if (!await wake.wait(options.idleTimeoutMs)) throw new Error(formatStreamIdleTimeoutError(options.idleTimeoutMs));
    }
  } finally {
    done = true;
    options.signal?.removeEventListener("abort", onAbort);
    req?.destroy();
  }
}
