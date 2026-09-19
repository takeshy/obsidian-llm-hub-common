import * as http from "node:http";
import * as net from "node:net";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { runLocalLlmChat } from "./localLlmProvider.js";
import type { StreamChunk } from "./provider.js";

/** Real HTTP framing around controlled provider responses; no model or external API required. */
describe("local server transport integration", () => {
  it.each(["ollama", "lm-studio"])("streams %s over an actual loopback socket", async framework => {
    const received: Array<{ path: string; body: Record<string, unknown>; length: string | undefined }> = [];
    const server = http.createServer(async (req, res) => {
      let body = "";
      for await (const data of req) body += data.toString();
      received.push({ path: req.url!, body: JSON.parse(body), length: req.headers["content-length"] });
      res.writeHead(200, { "Content-Type": framework === "ollama" ? "application/x-ndjson" : "text/event-stream" });
      const payload = framework === "ollama"
        ? JSON.stringify({ message: { content: "回答" }, done: true, prompt_eval_count: 3, eval_count: 2 })
        : `data: ${JSON.stringify({ choices: [{ delta: { content: "回答" } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } })}\n\ndata: [DONE]`;
      const bytes = Buffer.from(payload);
      for (let index = 0; index < bytes.length; index++) res.write(bytes.subarray(index, index + 1));
      res.end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address() as { port: number };
      const chunks: StreamChunk[] = [];
      for await (const chunk of runLocalLlmChat({
        config: { framework, baseUrl: `http://127.0.0.1:${address.port}/`, model: "test" },
        messages: [{ role: "user", content: "質問", timestamp: 0 }], systemPrompt: "system", http,
      })) chunks.push(chunk);
      expect(chunks).toEqual([{ type: "text", content: "回答" }, { type: "done", usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } }]);
      expect(received[0].path).toBe(framework === "ollama" ? "/api/chat" : "/v1/chat/completions");
      expect(Number(received[0].length)).toBe(Buffer.byteLength(JSON.stringify(received[0].body)));
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
  it("does not reuse the socket of a streamed turn the server closes (llama.cpp style)", async () => {
    let connections = 0;
    // cpp-httplib servers (llama.cpp, llama-router) answer at most one streamed
    // request per connection and destroy the socket once the stream handle is
    // gone, without announcing Connection: close. A follow-up request that the
    // client pools onto that socket is reset instead of answered.
    const sockets = new Set<net.Socket>();
    const server = net.createServer(socket => {
      connections++;
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      let buffered = Buffer.alloc(0);
      let answered = false;
      socket.on("error", () => {});
      socket.on("data", chunk => {
        if (answered) return;
        buffered = Buffer.concat([buffered, chunk]);
        const headerEnd = buffered.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const headers = buffered.subarray(0, headerEnd).toString();
        const length = Number(/content-length:\s*(\d+)/i.exec(headers)?.[1] ?? 0);
        if (buffered.length < headerEnd + 4 + length) return;
        answered = true;
        const chunked = (text: string) => `${Buffer.byteLength(text).toString(16)}\r\n${text}\r\n`;
        socket.write("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n");
        socket.write(chunked(`data: ${JSON.stringify({ choices: [{ delta: { content: "回答" } }] })}\n\n`));
        socket.write(chunked("data: [DONE]\n\n"));
        socket.write("0\r\n\r\n");
        setTimeout(() => socket.destroy(), 25).unref();
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address() as { port: number };
      const config = { framework: "lm-studio" as const, baseUrl: `http://127.0.0.1:${address.port}/`, model: "test" };
      const turn = async () => {
        const chunks: StreamChunk[] = [];
        for await (const chunk of runLocalLlmChat({
          config, messages: [{ role: "user", content: "質問", timestamp: 0 }], systemPrompt: "", http,
        })) chunks.push(chunk);
        return chunks;
      };
      expect(await turn()).toEqual([{ type: "text", content: "回答" }, { type: "done" }]);
      // The tool result follows at once, the way a local tool continues a turn.
      expect(await turn()).toEqual([{ type: "text", content: "回答" }, { type: "done" }]);
      expect(connections).toBe(2);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
