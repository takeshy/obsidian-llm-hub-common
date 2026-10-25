import { Setting, type ButtonComponent } from "obsidian";
import { t, getLocale } from "../i18n/index.js";
import { fetchTavilyUsage, getTavilyUsage, getBraveUsage, subscribeWebSearchUsage, type CreditAllowance } from "../core/webSearchUsage.js";
import type { WebSearchTransport } from "../core/externalWebSearch.js";

function credits(name: string, allowance: CreditAllowance): string {
  const amount = allowance.remaining === null ? t("settings.webSearch.usage.unlimited")
    : t("settings.webSearch.usage.credits", { remaining: allowance.remaining.toLocaleString(getLocale()), limit: allowance.limit!.toLocaleString(getLocale()) });
  return `${name}: ${amount}`;
}

/** A provider's quota belongs under its own API key, including when it is inactive. */
export function addWebSearchUsageSetting(containerEl: HTMLElement, options: {
  provider: "tavily" | "brave";
  getApiKey: () => string;
  transport?: WebSearchTransport;
}): { render: () => void; dispose: () => void } {
  const { provider, getApiKey } = options;
  const row = new Setting(containerEl).setName(t(provider === "tavily"
    ? "settings.webSearch.usage.remainingCredits" : "settings.webSearch.usage.remainingRequests"));
  let busy = false;
  let error: { key: string; message: string } | undefined;
  let disposed = false;
  let button: ButtonComponent | undefined;
  const render = () => {
    if (disposed) return;
    const key = getApiKey().trim();
    button?.setDisabled(busy || !key);
    if (!key) { row.setDesc(t("settings.webSearch.usage.noKey")); return; }
    if (busy) { row.setDesc(t("settings.webSearch.usage.loading")); return; }
    if (error?.key === key) { row.setDesc(t("settings.webSearch.usage.error", { error: error.message })); return; }
    if (provider === "tavily") {
      const usage = getTavilyUsage(key);
      if (!usage) { row.setDesc(t("settings.webSearch.usage.notFetched")); return; }
      const lines = [credits(t("settings.webSearch.usage.plan"), usage.plan)];
      if (usage.key) lines.push(credits(t("settings.webSearch.usage.key"), usage.key));
      if (usage.paygo) lines.push(credits(t("settings.webSearch.usage.paygo"), usage.paygo));
      lines.push(t("settings.webSearch.usage.asOf", { date: new Date(usage.fetchedAt).toLocaleString(getLocale()) }));
      row.setDesc(lines.join(" / "));
    } else {
      const usage = getBraveUsage(key);
      const windows = usage?.windows.filter(window => window.windowSeconds > 1);
      if (!usage || !windows?.length) { row.setDesc(t("settings.webSearch.usage.braveNotFetched")); return; }
      const lines = windows.map(window => {
        const amount = window.remaining === null ? t("settings.webSearch.usage.unlimited")
          : t("settings.webSearch.usage.requests", { remaining: window.remaining.toLocaleString(getLocale()), limit: window.limit.toLocaleString(getLocale()) });
        const period = window.windowSeconds % 86400 === 0
          ? t("settings.webSearch.usage.days", { count: window.windowSeconds / 86400 })
          : t("settings.webSearch.usage.seconds", { count: window.windowSeconds });
        const reset = window.resetsAt === undefined ? ""
          : window.resetsAt <= Date.now() ? ` (${t("settings.webSearch.usage.expired")})`
          : ` (${t("settings.webSearch.usage.resets", { date: new Date(window.resetsAt).toLocaleString(getLocale()) })})`;
        return `${period}: ${amount}${reset}`;
      });
      lines.push(t("settings.webSearch.usage.asOf", { date: new Date(usage.fetchedAt).toLocaleString(getLocale()) }));
      row.setDesc(lines.join(" / "));
    }
  };
  if (provider === "tavily") row.addButton(control => {
    button = control;
    control.setButtonText(t("settings.webSearch.usage.showCredits")).onClick(() => {
      if (busy || !getApiKey().trim()) return;
      const key = getApiKey().trim();
      busy = true;
      error = undefined;
      render();
      void fetchTavilyUsage(key, options.transport).catch(failure => {
        error = { key, message: failure instanceof Error ? failure.message : "Tavily usage request failed." };
      }).finally(() => { busy = false; render(); });
    });
  });
  render();
  const unsubscribe = subscribeWebSearchUsage(render);
  return { render, dispose: () => { disposed = true; unsubscribe(); } };
}
