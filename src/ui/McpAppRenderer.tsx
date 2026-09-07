import { useEffect, useRef, useState, useCallback } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { McpAppResult, McpAppUiResource } from "../core/message.js";
import type { McpServerConfig } from "../core/mcpTypes.js";
import type { IMcpClient } from "../mcp/httpClient.js";
import { createClientFromAppInfo } from "../mcp/clientUtils.js";
import { mcpClientInfo } from "../mcp/clientInfo.js";
import { t } from "../i18n/index.js";
import { cls } from "../core/classPrefix.js";
import { prepareMcpAppHtml } from "../mcp/appCsp.js";

// JSON-RPC message types for postMessage communication
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface FloatingFrame { left: number; top: number; width: number; height: number }
interface PointerStart extends FloatingFrame { x: number; y: number }

interface McpAppRendererProps {
  classPrefix?: string;
  // The MCP server URL for callbacks
  serverUrl: string;
  // Optional headers for the MCP server
  serverHeaders?: Record<string, string>;
  // Full server config for creating the appropriate client (supports stdio)
  /** As stored on the message: the shared record, which is looser than this plugin's own. */
  serverConfig?: McpServerConfig;
  // The tool result containing UI metadata
  toolResult: McpAppResult;
  // Pre-fetched UI resource content (if available)
  uiResource?: McpAppUiResource | null;
  // Callback when the UI requests a tool call
  onToolCall?: (toolName: string, args: Record<string, unknown>) => Promise<unknown>;
  // Callback when the UI updates model context
  onContextUpdate?: (context: Record<string, unknown>) => void;
  // Height of the iframe (default: 400px)
  height?: number;
  // Whether the app is expanded
  expanded?: boolean;
  // Toggle expand callback
  onToggleExpand?: () => void;
}

/**
 * MCP Apps Renderer Component
 *
 * Renders MCP Apps in a sandboxed iframe with JSON-RPC over postMessage
 * for bidirectional communication.
 */
export function McpAppRenderer({
  classPrefix = "llm-hub",
  serverUrl,
  serverHeaders,
  serverConfig,
  toolResult,
  uiResource: initialUiResource,
  onToolCall,
  onContextUpdate,
  height = 400,
  expanded = false,
  onToggleExpand,
}: McpAppRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<PointerStart | null>(null);
  const resizeStartRef = useRef<PointerStart | null>(null);
  const [loading, setLoading] = useState(!initialUiResource);
  const [error, setError] = useState<string | null>(null);
  const [uiResource, setUiResource] = useState<McpAppUiResource | null>(initialUiResource || null);
  const [iframeHtml, setIframeHtml] = useState<string | null>(null);
  const clientRef = useRef<IMcpClient | null>(null);
  const [floatingFrame, setFloatingFrame] = useState<FloatingFrame | null>(null);

  useEffect(() => {
    if (!expanded) { setFloatingFrame(null); return; }
    const view = appRef.current?.ownerDocument.defaultView ?? window;
    const width = Math.max(360, Math.min(960, view.innerWidth * 0.8));
    const height = Math.max(280, Math.min(720, view.innerHeight * 0.8));
    setFloatingFrame({
      left: Math.max(8, (view.innerWidth - width) / 2),
      top: Math.max(8, (view.innerHeight - height) / 2),
      width,
      height,
    });
  }, [expanded]);

  const startPointer = (event: ReactPointerEvent<HTMLElement>, target: "drag" | "resize") => {
    if (!expanded || !appRef.current) return;
    if (target === "drag" && (event.target as Element).closest("button")) return;
    const rect = appRef.current.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    if (target === "drag") dragStartRef.current = start;
    else resizeStartRef.current = start;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const start = dragStartRef.current;
    if (!start) return;
    const view = event.currentTarget.ownerDocument.defaultView ?? window;
    const left = Math.min(view.innerWidth - 80, Math.max(8 - start.width + 80, start.left + event.clientX - start.x));
    const top = Math.min(view.innerHeight - 48, Math.max(8, start.top + event.clientY - start.y));
    setFloatingFrame({ left, top, width: start.width, height: start.height });
  };

  const moveResize = (event: ReactPointerEvent<HTMLElement>) => {
    const start = resizeStartRef.current;
    if (!start) return;
    const view = event.currentTarget.ownerDocument.defaultView ?? window;
    const width = Math.max(360, Math.min(view.innerWidth - start.left - 8, start.width + event.clientX - start.x));
    const height = Math.max(280, Math.min(view.innerHeight - start.top - 8, start.height + event.clientY - start.y));
    setFloatingFrame({ left: start.left, top: start.top, width, height });
  };

  const stopPointer = (event: ReactPointerEvent<HTMLElement>, target: "drag" | "resize") => {
    if (target === "drag") dragStartRef.current = null;
    else resizeStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  // Get the UI resource URI from the tool result
  const resourceUri = toolResult._meta?.ui?.resourceUri;

  // Fetch UI resource if not provided
  useEffect(() => {
    if (!resourceUri || initialUiResource) return;

    const fetchResource = async () => {
      try {
        setLoading(true);
        setError(null);

        // Create MCP client
        const client = createClientFromAppInfo(serverConfig, serverUrl, serverHeaders);
        clientRef.current = client;

        // Fetch the UI resource
        const resource = await client.readResource(resourceUri);
        if (resource) {
          setUiResource(resource);
        } else {
          setError(t("mcpApp.resourceNotFound"));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t("mcpApp.fetchError"));
      } finally {
        setLoading(false);
      }
    };

    void fetchResource();

    return () => {
      // Cleanup client on unmount
      if (clientRef.current) {
        void clientRef.current.close();
        clientRef.current = null;
      }
    };
  }, [resourceUri, serverUrl, serverHeaders, serverConfig, initialUiResource]);

  // Handle messages from iframe
  const handleMessage = useCallback(async (event: MessageEvent) => {
    // Only handle messages from our iframe
    if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) {
      return;
    }

    const message = event.data as JsonRpcRequest;

    if (message.jsonrpc !== "2.0") return;

    const sendResponse = (response: JsonRpcResponse) => {
      // Using "*" origin is required for srcdoc iframes as they have null origin
      iframeRef.current?.contentWindow?.postMessage(response, "*");
    };

    try {
      switch (message.method) {
        case "ui/initialize": {
          if (typeof message.id === "undefined") return;
          sendResponse({ jsonrpc: "2.0", id: message.id, result: {
            protocolVersion: "2026-01-26",
            hostInfo: { name: mcpClientInfo().name, version: mcpClientInfo().version },
            hostCapabilities: { serverTools: {} },
            hostContext: { theme: document.body.classList.contains("theme-dark") ? "dark" : "light", platform: "desktop", displayMode: "inline" },
          } });
          return;
        }
        case "ui/notifications/initialized": {
          iframeRef.current?.contentWindow?.postMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: toolResult }, "*");
          return;
        }
        case "tools/call": {
          if (typeof message.id === "undefined") return;
          // UI is requesting to call a tool
          const params = message.params as { name: string; arguments?: Record<string, unknown> } | undefined;
          if (!params?.name) {
            sendResponse({
              jsonrpc: "2.0",
              id: message.id,
              error: { code: -32602, message: "Invalid params: missing tool name" },
            });
            return;
          }

          if (onToolCall) {
            const result = await onToolCall(params.name, params.arguments || {});
            sendResponse({
              jsonrpc: "2.0",
              id: message.id,
              result,
            });
          } else {
            // Default: call tool via MCP client
            const client = clientRef.current || createClientFromAppInfo(serverConfig, serverUrl, serverHeaders);

            const result = await client.callToolWithUi(params.name, params.arguments || {});
            sendResponse({
              jsonrpc: "2.0",
              id: message.id,
              result,
            });
          }
          break;
        }

        case "context/update": {
          // UI is updating the model context
          if (message.params && onContextUpdate) {
            onContextUpdate(message.params);
          }
          sendResponse({
            jsonrpc: "2.0",
            id: message.id,
            result: { success: true },
          });
          break;
        }

        default:
          sendResponse({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32601, message: `Method not found: ${message.method}` },
          });
      }
    } catch (err) {
      sendResponse({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : "Internal error",
        },
      });
    }
  }, [serverUrl, serverHeaders, serverConfig, onToolCall, onContextUpdate]);

  // Set up message listener
  useEffect(() => {
    const messageHandler = (event: MessageEvent) => {
      void handleMessage(event);
    };
    window.addEventListener("message", messageHandler);
    return () => window.removeEventListener("message", messageHandler);
  }, [handleMessage]);

  // Send initial tool result to iframe once loaded
  const handleIframeLoad = useCallback(() => {
    setLoading(false);
  }, []);

  // Generate iframe content (server-provided HTML should already contain SDK per MCP Apps spec)
  const getIframeContent = (): string => {
    if (!uiResource) return "";

    // Get the HTML content
    let html = uiResource.text || "";

    // If it's binary data, decode it
    if (uiResource.blob && !uiResource.text) {
      try {
        html = atob(uiResource.blob);
      } catch {
        // Return error page
        return `<html><body><p>${t("mcpApp.decodeError")}</p></body></html>`;
      }
    }

    return html;
  };

  useEffect(() => {
    if (!uiResource) { setIframeHtml(null); return; }
    let cancelled = false;
    void prepareMcpAppHtml(getIframeContent(), uiResource).then(html => {
      if (cancelled) return;
      setIframeHtml(html);
    }).catch(error => setError(error instanceof Error ? error.message : String(error)));
    return () => { cancelled = true; };
  }, [uiResource]);

  // Render loading state
  if (loading) {
    return (
      <div className={cls("mcp-app-loading")}>
        <span className={cls("mcp-app-spinner")} />
        <span>{t("mcpApp.loading")}</span>
      </div>
    );
  }

  // Render error state
  if (error) {
    return (
      <div className={cls("mcp-app-error")}>
        <span>{t("mcpApp.error")}: {error}</span>
      </div>
    );
  }

  // No UI resource available
  if (!uiResource) {
    return null;
  }

  if (!iframeHtml) {
    return <div className={cls("mcp-app-loading")}><span className={cls("mcp-app-spinner")} /><span>{t("mcpApp.loading")}</span></div>;
  }

  return (
    <div ref={appRef} className={`${classPrefix}-mcp-app ${expanded ? cls("mcp-app-expanded") : ""}`}
      style={expanded && floatingFrame ? ({ left: floatingFrame.left, top: floatingFrame.top, width: floatingFrame.width, height: floatingFrame.height } satisfies CSSProperties) : undefined}>
      <div className={cls("mcp-app-header")} onPointerDown={event => startPointer(event, "drag")}
        onPointerMove={moveDrag} onPointerUp={event => stopPointer(event, "drag")} onPointerCancel={event => stopPointer(event, "drag")}>
        <span className={cls("mcp-app-indicator")}>
          🖥️ {t("mcpApp.title")}
        </span>
        {onToggleExpand && (
          <button
            className={cls("mcp-app-expand-btn")}
            onClick={onToggleExpand}
            title={expanded ? t("mcpApp.collapse") : t("mcpApp.expand")}
          >
            {expanded ? "⊖" : "⊕"}
          </button>
        )}
      </div>
      <iframe
        key={uiResource.uri}
        ref={iframeRef}
        srcDoc={iframeHtml}
        sandbox="allow-scripts allow-forms"
        onLoad={handleIframeLoad}
        className={`${classPrefix}-mcp-app-iframe ${expanded ? cls("mcp-app-iframe-expanded") : ""}`}
        data-height={height}
        title="MCP App"
      />
      {expanded && <div className={cls("mcp-app-resize-handle")} role="separator" aria-label={t("dashboard.dragToResize")}
        onPointerDown={event => startPointer(event, "resize")} onPointerMove={moveResize}
        onPointerUp={event => stopPointer(event, "resize")} onPointerCancel={event => stopPointer(event, "resize")} />}
    </div>
  );
}

export default McpAppRenderer;
