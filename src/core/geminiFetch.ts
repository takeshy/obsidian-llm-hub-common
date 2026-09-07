import { Platform, requestUrl } from "obsidian";

function requestHeaders(init?: RequestInit): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!init?.headers) return headers;
  if (init.headers instanceof Headers) {
    init.headers.forEach((value, key) => { headers[key] = value; });
  } else if (Array.isArray(init.headers)) {
    for (const [key, value] of init.headers) headers[key] = value;
  } else {
    Object.assign(headers, init.headers);
  }
  return headers;
}

/** Desktop streaming fetch that bypasses renderer CORS through Electron's Node runtime. */
export async function geminiNodeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const electronWindow = window as unknown as {
    require: (id: string) => typeof import("https");
    URL: typeof URL;
  };
  const https = electronWindow.require("https");
  const url = typeof input === "string"
    ? new electronWindow.URL(input)
    : input instanceof electronWindow.URL ? input : new electronWindow.URL(input.url);
  const method = init?.method ?? "GET";
  const headers = requestHeaders(init);

  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers }, (res: import("http").IncomingMessage) => {
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(res.headers)) {
        if (value) responseHeaders.set(key, Array.isArray(value) ? value.join(", ") : value);
      }

      const body = new ReadableStream({
        start(controller) {
          res.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
          res.on("end", () => controller.close());
          res.on("error", (error) => controller.error(error));
        },
        cancel() {
          res.destroy();
        },
      });

      resolve(new Response(body, {
        status: res.statusCode ?? 200,
        statusText: res.statusMessage ?? "",
        headers: responseHeaders,
      }));
    });

    req.on("error", reject);
    if (init?.signal) {
      init.signal.addEventListener("abort", () => req.destroy());
    }

    if (!init?.body) {
      req.end();
    } else if (typeof init.body === "string") {
      req.end(init.body);
    } else if (init.body instanceof ArrayBuffer || ArrayBuffer.isView(init.body)) {
      req.end(Buffer.from(init.body as ArrayBuffer));
    } else {
      const reader = (init.body as ReadableStream<Uint8Array>).getReader();
      const pump = (): void => {
        reader.read().then(({ done, value }) => {
          if (done) {
            req.end();
            return;
          }
          req.write(value);
          pump();
        }).catch((error: Error) => req.destroy(error));
      };
      pump();
    }
  });
}

/** Mobile buffered fetch that bypasses CORS through Obsidian's HTTP API. */
export async function geminiMobileFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string"
    ? input
    : input instanceof window.URL ? input.toString() : input.url;
  const method = init?.method ?? "GET";
  const headers = requestHeaders(init);
  const body = init?.body
    ? typeof init.body === "string" ? init.body : JSON.stringify(init.body)
    : undefined;
  const result = await requestUrl({ url, method, headers, body, throw: false });
  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(result.headers)) {
    if (value) responseHeaders.set(key, value);
  }
  const encoded = new TextEncoder().encode(result.text);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    },
  });
  return new Response(stream, { status: result.status, headers: responseHeaders });
}

/** CORS-free fetch used by the Gemini Interactions API. */
export function geminiCorsFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return Platform.isMobile ? geminiMobileFetch(input, init) : geminiNodeFetch(input, init);
}
