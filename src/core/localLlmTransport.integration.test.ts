import * as http from "node:http";
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
});
