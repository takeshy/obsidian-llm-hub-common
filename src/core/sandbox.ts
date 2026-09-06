/**
 * Runs untrusted JavaScript in a sandboxed iframe and returns what it produced.
 *
 * The iframe is created with only allow-scripts, so the code has no access to the vault, the
 * plugin or the network beyond what the browser gives an opaque origin.
 */
const DEFAULT_TIMEOUT_MS = 10_000;

const SANDBOX_HTML = `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval';"><script>
window.addEventListener('message', async function(event) {
  try {
    var code = event.data.code;
    var input = event.data.input;
    var fn = new Function('input', code);
    var result = fn(input);
    if (result && typeof result.then === 'function') {
      result = await result;
    }
    if (result === undefined || result === null) {
      result = '';
    } else if (typeof result !== 'string') {
      result = JSON.stringify(result);
    }
    parent.postMessage({ type: 'result', value: result }, '*');
  } catch (e) {
    parent.postMessage({ type: 'error', message: e.message || String(e) }, '*');
  }
});
parent.postMessage({ type: 'ready' }, '*');
</` + `script></head><body></body></html>`;

export function executeSandboxedJS(
  code: string,
  input?: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const iframe = createEl("iframe");
    iframe.sandbox.add("allow-scripts");
    iframe.setCssStyles({ display: "none" });

    let settled = false;

    const cleanup = (timer: number) => {
      window.clearTimeout(timer);
      activeWindow.removeEventListener("message", handler);
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    };

    const handler = (event: MessageEvent<unknown>) => {
      if (event.source !== iframe.contentWindow) return;
      const data: unknown = event.data;
      if (!data || typeof data !== "object") return;
      const message = data as Record<string, unknown>;

      if (message.type === "ready" && !settled) {
        iframe.contentWindow!.postMessage({ code, input }, "*");
        return;
      }

      if (message.type === "result" && !settled) {
        settled = true;
        cleanup(timer);
        resolve(typeof message.value === "string" ? message.value : "");
        return;
      }

      if (message.type === "error" && !settled) {
        settled = true;
        cleanup(timer);
        reject(new Error(typeof message.message === "string" ? message.message : "Script execution error"));
      }
    };

    activeWindow.addEventListener("message", handler);

    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup(timer);
        reject(new Error("Script execution timed out"));
      }
    }, timeoutMs);

    iframe.srcdoc = SANDBOX_HTML;
    document.body.appendChild(iframe);
  });
}
