import { beforeEach, describe, expect, it, vi } from "vitest";
const ui = vi.hoisted(() => ({ rows: [] as Array<{ name: string; desc: string; disabled: boolean; button: string; click?: () => void }> }));
vi.mock("obsidian", () => ({ requestUrl: vi.fn(), Setting: class {
  row = { name: "", desc: "", disabled: false, button: "", click: undefined as (() => void) | undefined };
  constructor() { ui.rows.push(this.row); }
  setName(value: string) { this.row.name = value; return this; }
  setDesc(value: string) { this.row.desc = value; return this; }
  addButton(callback: (button: unknown) => void) {
    const row = this.row;
    callback({ setButtonText(value: string) { row.button = value; return this; },
      setDisabled(value: boolean) { row.disabled = value; return this; },
      onClick(callback: () => void) { row.click = callback; return this; },
    }); return this;
  }
} }));
import { requestUrl } from "obsidian";
import { addWebSearchUsageSetting } from "./webSearchUsage.js";
import { recordBraveUsage } from "../core/webSearchUsage.js";
import { setLocale } from "../i18n/index.js";
let nextKey = 0;
beforeEach(() => { ui.rows = []; vi.mocked(requestUrl).mockReset(); setLocale("en"); });
const payload = { account: { plan_usage: 150, plan_limit: 1000, paygo_usage: 0, paygo_limit: 100 }, key: { usage: 100, limit: null } };

describe("settings usage rows", () => {
  it("fetches Tavily only after the display button is clicked, including inactive provider keys", async () => {
    const key = `ui-tavily-${++nextKey}`;
    vi.mocked(requestUrl).mockResolvedValue({ status: 200, json: payload } as never);
    const control = addWebSearchUsageSetting({} as HTMLElement, { provider: "tavily", getApiKey: () => key });
    const row = ui.rows[0];
    expect(requestUrl).not.toHaveBeenCalled();
    expect(row.button).toBe("Show remaining credits");
    row.click!();
    expect(row.disabled).toBe(true);
    await vi.waitFor(() => expect(row.desc).toContain("850 / 1,000 credits remaining"));
    expect(row.desc).toContain("No limit for this scope");
    expect(row.desc).toContain("Pay as you go");
    expect(row.desc).toContain("Last checked:");
    expect(row.disabled).toBe(false);
    control.dispose();
  });
  it("does not display a previous key's in-flight usage and disables empty-key requests", async () => {
    let key = `old-key-${++nextKey}`;
    let finish!: (value: unknown) => void;
    vi.mocked(requestUrl).mockImplementation(() => new Promise(resolve => { finish = resolve; }) as never);
    const control = addWebSearchUsageSetting({} as HTMLElement, { provider: "tavily", getApiKey: () => key });
    const row = ui.rows[0]; row.click!();
    key = `new-key-${++nextKey}`;
    finish({ status: 200, json: payload });
    await vi.waitFor(() => expect(row.disabled).toBe(false));
    expect(row.desc).not.toContain("850");
    key = ""; control.render();
    expect(row.disabled).toBe(true);
    row.click!();
    expect(requestUrl).toHaveBeenCalledOnce();
    control.dispose();
  });
  it("shows localized failure without exposing credentials", async () => {
    setLocale("ja");
    vi.mocked(requestUrl).mockResolvedValue({ status: 401, json: { secret: "sensitive-key" } } as never);
    const control = addWebSearchUsageSetting({} as HTMLElement, { provider: "tavily", getApiKey: () => "sensitive-key" });
    const row = ui.rows[0]; expect(row.button).toBe("残りクレジットを表示"); row.click!();
    await vi.waitFor(() => expect(row.desc).toContain("HTTP 401"));
    expect(row.desc).toContain("使用量を取得できませんでした");
    expect(row.desc).not.toContain("sensitive-key");
    control.dispose();
  });
  it("updates Brave from passive observations and stops updating after disposal", () => {
    const key = `brave-ui-${++nextKey}`;
    const control = addWebSearchUsageSetting({} as HTMLElement, { provider: "brave", getApiKey: () => key });
    const row = ui.rows[0];
    expect(row.button).toBe("");
    expect(row.desc).toContain("after a Brave search");
    expect(requestUrl).not.toHaveBeenCalled();
    const headers = { "X-RateLimit-Limit": "1, 1000", "X-RateLimit-Policy": "1;w=1, 1000;w=2592000", "X-RateLimit-Remaining": "0, 0" };
    recordBraveUsage(key, headers);
    expect(row.desc).toContain("30-day window: 0 / 1,000 requests remaining");
    expect(row.desc).not.toContain("1-second window");
    expect(row.desc).toContain("Last checked:");
    control.dispose(); const last = row.desc;
    recordBraveUsage(key, { ...headers, "X-RateLimit-Remaining": "1, 100" });
    expect(row.desc).toBe(last);
  });
});
