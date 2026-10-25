import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The isolated document Google Search Suggestions render in. Google's HTML/CSS goes in
 * unmodified; the wrapper only adds what isolation needs: a CSP that forbids every script and
 * connection, and a base target so a chip opens in the browser instead of inside the frame.
 */
export function buildSearchSuggestionsDocument(renderedContent: string): string {
  const csp = [
    "default-src 'none'",
    "script-src 'none'",
    "style-src 'unsafe-inline' https:",
    "img-src https: data:",
    "font-src https: data:",
    "form-action 'none'",
  ].join("; ");
  return "<!DOCTYPE html><html><head><meta charset=\"utf-8\">"
    + `<meta http-equiv="Content-Security-Policy" content="${csp}">`
    + "<base target=\"_blank\"></head><body style=\"margin:0\">"
    + renderedContent
    + "</body></html>";
}

/**
 * The frame's sandbox. No `allow-scripts`, so nothing inside can run and reach the Vault or
 * Node.js; same-origin is only there so the parent can read the content height. Popups let a
 * chip open Google in the external browser; navigation of the parent is not allowed.
 */
export const SEARCH_SUGGESTIONS_SANDBOX = "allow-same-origin allow-popups allow-popups-to-escape-sandbox";

interface SearchSuggestionsProps {
  classPrefix: string;
  renderedContent: string;
  title: string;
}

/**
 * Google Search Suggestions shown next to a Grounded Result, as Google requires. No click
 * tracking: the links are Google's own and open as they are.
 */
export function SearchSuggestions({ classPrefix, renderedContent, title }: SearchSuggestionsProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);

  const measure = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    const next = doc?.documentElement?.scrollHeight;
    if (next && next !== height) setHeight(next);
  }, [height]);

  useEffect(() => {
    const frame = frameRef.current;
    const view = frame?.ownerDocument.defaultView;
    if (!view) return;
    view.addEventListener("resize", measure);
    return () => view.removeEventListener("resize", measure);
  }, [measure]);

  return (
    <div className={`${classPrefix}-search-suggestions`}>
      <iframe
        ref={frameRef}
        className={`${classPrefix}-search-suggestions-frame`}
        title={title}
        sandbox={SEARCH_SUGGESTIONS_SANDBOX}
        referrerPolicy="no-referrer"
        srcDoc={buildSearchSuggestionsDocument(renderedContent)}
        onLoad={measure}
        style={height ? { height } : undefined}
      />
    </div>
  );
}
