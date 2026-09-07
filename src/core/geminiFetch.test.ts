import { beforeEach, describe, expect, it, vi } from "vitest";

const requestUrl = vi.hoisted(() => vi.fn());

vi.mock("obsidian", () => ({
  Platform: { isMobile: true },
  requestUrl,
}));

import { geminiCorsFetch } from "./geminiFetch.js";

describe("Gemini CORS fetch", () => {
  beforeEach(() => {
    requestUrl.mockReset();
    vi.stubGlobal("window", { URL });
  });

  it("uses Obsidian requestUrl on mobile and wraps its buffered response", async () => {
    requestUrl.mockResolvedValue({
      status: 201,
      headers: { "content-type": "text/event-stream" },
      text: "data: response\n\n",
    });

    const response = await geminiCorsFetch("https://example.com/interactions", {
      method: "POST",
      headers: { Authorization: "Bearer secret" },
      body: "{\"input\":\"hello\"}",
    });

    expect(requestUrl).toHaveBeenCalledWith({
      url: "https://example.com/interactions",
      method: "POST",
      headers: { Authorization: "Bearer secret" },
      body: "{\"input\":\"hello\"}",
      throw: false,
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    await expect(response.text()).resolves.toBe("data: response\n\n");
  });
});
