import { useEffect, useRef, useState } from "react";
import { t } from "../i18n/index.js";

export function canRenderGoogleSearchSuggestions(): boolean {
  if (typeof document === "undefined" || typeof ResizeObserver === "undefined") return false;
  const frame = document.createElement("iframe");
  return "srcdoc" in frame && "sandbox" in frame;
}

/** Isolate the original Google HTML/CSS; scripts and embedded navigation are disabled. */
export function GoogleSearchSuggestions({ html, classPrefix = "chat-ui" }: { html: string; classPrefix?: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(100);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    let contentObserver: ResizeObserver | undefined;
    const resize = () => {
      const body = element.contentDocument?.body;
      if (body) setHeight(Math.max(1, Math.ceil(body.scrollHeight)));
    };
    const loaded = () => {
      contentObserver?.disconnect();
      const body = element.contentDocument?.body;
      if (body) { contentObserver = new ResizeObserver(resize); contentObserver.observe(body); }
      resize();
    };
    const widthObserver = new ResizeObserver(resize);
    widthObserver.observe(element);
    element.addEventListener("load", loaded);
    loaded();
    return () => { widthObserver.disconnect(); contentObserver?.disconnect(); element.removeEventListener("load", loaded); };
  }, [html]);
  return <iframe ref={frame} className={`${classPrefix}-google-search-suggestions`}
    title={t("grounding.searchSuggestions")}
    sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
    referrerPolicy="no-referrer" style={{ height }}
    srcDoc={`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' https:; img-src https: data:; font-src https: data:; base-uri 'none'; form-action 'none'"><base target="_blank"></head><body style="margin:0">${html}</body></html>`}
  />;
}

export function GroundingAutoSaveNotice({ classPrefix = "chat-ui" }: { classPrefix?: string }) {
  return <div className={`${classPrefix}-grounding-save-notice`} role="status">
    <strong>{t("grounding.autoSaveTitle")}</strong><p>{t("grounding.autoSaveDescription")}</p>
  </div>;
}
