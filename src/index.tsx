import { Fragment, useEffect, useRef, useState, type ChangeEvent, type ReactNode, type Ref, type TextareaHTMLAttributes, type MouseEvent } from "react";
import { BookOpen, LayoutDashboard, Plus, Copy, Check, Send, StopCircle, Loader2, ChevronUp, ChevronDown, Database, Wrench, X, Paperclip, FileText, Maximize2, Minimize2 } from "lucide-react";

export interface ChatMessage {
  role: string;
  content: string;
  timestamp: number;
  thinking?: string;
}
export type { StyleProps } from "./types.js";
import type { StyleProps } from "./types.js";
import type { SearchSelection } from "./core/events.js";

/** The host owns lifecycle, persistence and provider execution. */
export function ChatLayout({ classPrefix: p, modifiers, children }: StyleProps & { modifiers?: readonly (string | false | undefined)[]; children: ReactNode }) {
  return <div className={[`${p}-chat`, ...(modifiers ?? [])].filter(Boolean).join(" ")}>{children}</div>;
}

/** A button in the chat header strip. */
export function HeaderButton({ classPrefix: p, title, onClick, disabled, className, children }: StyleProps & { title: string; onClick: () => void; disabled?: boolean; className?: string; children: ReactNode }) {
  return <button className={[`${p}-header-btn`, className].filter(Boolean).join(" ")} onClick={onClick} disabled={disabled} title={title}>{children}</button>;
}

/** Widen or narrow the sidebar the chat lives in. */
export function SidebarWidthButton({ classPrefix: p, wide, title, onClick }: StyleProps & { wide: boolean; title: string; onClick: () => void }) {
  return <HeaderButton classPrefix={p} className={`${p}-sidebar-width-btn`} title={title} onClick={onClick}>
    {wide ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
  </HeaderButton>;
}

/** Save the conversation as a note, showing progress in place of the icon. */
export function SaveNoteButton({ classPrefix: p, state, title, disabled, onClick }: StyleProps & { state: "idle" | "saving" | "saved"; title: string; disabled?: boolean; onClick: () => void }) {
  return <HeaderButton classPrefix={p} title={title} disabled={disabled || state === "saving"} onClick={onClick}>
    {state === "idle" && <FileText size={16} />}
    {state === "saving" && <Loader2 size={16} className={`${p}-spin`} />}
    {state === "saved" && <Check size={16} />}
  </HeaderButton>;
}

export interface MessageListProps<M extends ChatMessage> extends StyleProps {
  messages: readonly M[];
  streamingContent: string;
  streamingThinking: string;
  isLoading: boolean;
  containerRef?: Ref<HTMLDivElement>;
  emptyState?: ReactNode;
  renderMessage: (message: M, index: number, sourceFileName: string | null) => ReactNode;
  renderStreamingMessage: (message: ChatMessage & { role: "assistant" }) => ReactNode;
}

export function MessageList<M extends ChatMessage>({ classPrefix: p, messages, streamingContent, streamingThinking, isLoading, containerRef, emptyState, renderMessage, renderStreamingMessage }: MessageListProps<M>) {
  let source: string | null = null;
  return <div className={`${p}-messages`} ref={containerRef}>
    {messages.length === 0 && !streamingContent && emptyState}
    {messages.map((message, index) => {
      if (message.role === "user") {
        const match = message.content.match(/From "([^"]+\.md)"/);
        source = match ? match[1].split("/").pop()!.replace(".md", "") : null;
      }
      return <Fragment key={index}>{renderMessage(message, index, message.role === "assistant" ? source : null)}</Fragment>;
    })}
    {(streamingContent || streamingThinking) && renderStreamingMessage({ role: "assistant", content: streamingContent, timestamp: Date.now(), thinking: streamingThinking || undefined })}
    {isLoading && !streamingContent && !streamingThinking && <div className={`${p}-loading`}>
      <span className={`${p}-loading-dot`} /><span className={`${p}-loading-dot`} /><span className={`${p}-loading-dot`} />
    </div>}
  </div>;
}

export interface WelcomeProps extends StyleProps {
  title: string; hint: string;
  help: { title: string; description: string; label: string; onClick?: () => void };
  dashboard: { title: string; description: string; openLabel: string; createLabel: string; current?: { basename: string; path: string } | null; onOpen?: () => void; onCreate?: () => void };
  tips: readonly { icon?: string; text: string }[];
  cardStyle?: "card" | "dashboard";
}
export function Welcome({ classPrefix: p, title, hint, help, dashboard, tips, cardStyle = "dashboard" }: WelcomeProps) {
  const card = `${p}-empty-${cardStyle}`;
  return <div className={`${p}-empty-state`}>
    <p>{title}</p><p className={`${p}-empty-hint`}>{hint}</p>
    {help.onClick && <div className={card}>
      <div className={`${card}-heading`}><BookOpen size={16} aria-hidden="true" /><span>{help.title}</span></div>
      <p className={`${card}-description`}>{help.description}</p>
      <div className={`${card}-actions`}><button type="button" className={`${card}-${cardStyle === "card" ? "action" : "create"}`} onClick={help.onClick}><BookOpen size={14} aria-hidden="true" /><span>{help.label}</span></button></div>
    </div>}
    <div className={card}>
      <div className={`${card}-heading`}><LayoutDashboard size={16} aria-hidden="true" /><span>{dashboard.title}</span></div>
      <p className={`${card}-description`}>{dashboard.description}</p>
      <div className={`${card}-actions`}>
        {dashboard.current && dashboard.onOpen && <button type="button" className={`${card}-${cardStyle === "card" ? "action" : "link"}`} title={dashboard.current.path} onClick={dashboard.onOpen}><LayoutDashboard size={14} aria-hidden="true" /><span>{dashboard.openLabel}: {dashboard.current.basename}</span></button>}
        {dashboard.onCreate && <button type="button" className={`${card}-${cardStyle === "card" ? "action" : "create"}`} onClick={dashboard.onCreate}><Plus size={14} aria-hidden="true" /><span>{dashboard.createLabel}</span></button>}
      </div>
    </div>
    <div className={`${p}-empty-tips`}>{tips.map((tip, index) => <div key={index} className={`${p}-empty-tip`}>{tip.icon && <span className={`${p}-empty-tip-icon`}>{tip.icon}</span>}<span>{tip.text}</span></div>)}</div>
  </div>;
}

export interface MessageBubbleProps extends StyleProps {
  isUser: boolean; isStreaming?: boolean;
  roleLabel: ReactNode; timeLabel: string; copied: boolean; copyLabel: string; onCopy: () => void;
  children: ReactNode;
}
export function MessageBubble({ classPrefix: p, isUser, isStreaming, roleLabel, timeLabel, copied, copyLabel, onCopy, children }: MessageBubbleProps) {
  return <div className={`${p}-message ${p}-message-${isUser ? "user" : "assistant"} ${isStreaming ? `${p}-message-streaming` : ""}`}>
    <div className={`${p}-message-header`}>
      <span className={`${p}-message-role`}>{roleLabel}</span>
      <span className={`${p}-message-time`}>{timeLabel}</span>
      {!isStreaming && <button className={`${p}-copy-btn`} onClick={onCopy} title={copyLabel}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>}
    </div>
    {children}
  </div>;
}
export function MessageContent({ classPrefix: p, contentRef, thinking, thinkingLabel, thinkingOpen }: StyleProps & { contentRef: Ref<HTMLDivElement>; thinking?: string; thinkingLabel: ReactNode; thinkingOpen?: boolean }) {
  return <>
    {thinking && <details className={`${p}-thinking`} open={thinkingOpen}>
      <summary className={`${p}-thinking-summary`}>{thinkingLabel}</summary>
      <div className={`${p}-thinking-content`}>{thinking}</div>
    </details>}
    <div className={`${p}-message-content`} ref={contentRef} />
  </>;
}

/** `open` is set for attachments that lead somewhere, such as a RAG source note. */
export interface AttachmentDisplay { type: string; name: string; open?: { title: string; onOpen: () => void } }
const attachmentIcons: Record<string, string> = { image: "🖼️", pdf: "📄", text: "📃", audio: "🎵", video: "🎬" };
export function Attachments({ classPrefix: p, attachments, pending, removeLabel, onRemove }: StyleProps & { attachments?: readonly AttachmentDisplay[]; pending?: boolean; removeLabel?: string; onRemove?: (index: number) => void }) {
  if (!attachments?.length) return null;
  const itemClass = `${p}-${pending ? "pending-" : ""}attachment`;
  return <div className={`${itemClass}s`}>{attachments.map((item, index) => <span key={index} className={[itemClass, item.open && `${p}-clickable`].filter(Boolean).join(" ")} onClick={item.open?.onOpen} title={item.open?.title}>
    {attachmentIcons[item.type]} {item.name}
    {onRemove && <button className={`${itemClass}-remove`} onClick={(event) => { event.stopPropagation(); onRemove(index); }} title={removeLabel}>×</button>}
  </span>)}</div>;
}

export interface TokenUsage { inputTokens?: number; outputTokens?: number; thinkingTokens?: number; totalCost?: number }
export function UsageInfo({ classPrefix: p, isUser, isStreaming, elapsedMs, usage, tokensLabel, thinkingTokensLabel }: StyleProps & { isUser: boolean; isStreaming?: boolean; elapsedMs?: number; usage?: TokenUsage; tokensLabel: string; thinkingTokensLabel: string }) {
  if (isUser || isStreaming || !(usage || elapsedMs)) return null;
  return <div className={`${p}-usage-info`}>
    {elapsedMs !== undefined && <span>{elapsedMs < 1000 ? `${elapsedMs}ms` : `${(elapsedMs / 1000).toFixed(1)}s`}</span>}
    {usage?.inputTokens !== undefined && usage.outputTokens !== undefined && <span>{usage.inputTokens.toLocaleString()} → {usage.outputTokens.toLocaleString()} {tokensLabel}{usage.thinkingTokens ? ` (${thinkingTokensLabel} ${usage.thinkingTokens.toLocaleString()})` : ""}</span>}
    {usage?.totalCost !== undefined && <span>${usage.totalCost.toFixed(4)}</span>}
  </div>;
}

export interface ComposerProps extends StyleProps {
  textareaRef: Ref<HTMLTextAreaElement>;
  textarea: TextareaHTMLAttributes<HTMLTextAreaElement>;
  isLoading: boolean; isCompacting?: boolean; canSend: boolean;
  onSend: () => void; onStop?: () => void;
  sendLabel: string; stopLabel: string; compactingLabel?: string;
  collapse?: { collapsed: boolean; onToggle: () => void; label: string };
}
export function Composer({ classPrefix: p, textareaRef, textarea, isLoading, isCompacting, canSend, onSend, onStop, sendLabel, stopLabel, compactingLabel, collapse }: ComposerProps) {
  return <>
    <textarea ref={textareaRef} className={`${p}-input`} rows={3} {...textarea} />
    <div className={`${p}-send-buttons`}>
      {isCompacting ? <button className={`${p}-send-btn`} disabled title={compactingLabel}><Loader2 size={18} className={`${p}-spinner`} /></button>
        : isLoading ? <button className={`${p}-stop-btn`} onClick={onStop} title={stopLabel}><StopCircle size={18} /></button>
        : <button className={`${p}-send-btn`} onClick={onSend} disabled={!canSend} title={sendLabel}><Send size={18} /></button>}
      {collapse && <button className={`${p}-collapse-btn`} onClick={collapse.onToggle} title={collapse.label}>{collapse.collapsed ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>}
    </div>
  </>;
}

export interface AutocompleteItem { id: string; label: ReactNode; description?: ReactNode; action?: ReactNode }
export function Autocomplete({ classPrefix: p, items, activeIndex, onSelect, onHover, containerRef }: StyleProps & { items: readonly AutocompleteItem[]; activeIndex: number; onSelect: (index: number) => void; onHover: (index: number) => void; containerRef?: Ref<HTMLDivElement> }) {
  return <div className={`${p}-autocomplete`} ref={containerRef}>{items.map((item, index) => <div key={item.id} className={`${p}-autocomplete-item ${index === activeIndex ? "active" : ""}`} onClick={() => onSelect(index)} onMouseEnter={() => onHover(index)}>
    <span className={`${p}-autocomplete-name`}>{item.label}</span>
    {item.description && <span className={`${p}-autocomplete-desc`}>{item.description}</span>}
    {item.action}
  </div>)}</div>;
}

export interface HistoryEntry { id: string; title: string; dateLabel: string; encrypted?: boolean }
export function HistoryList<H extends HistoryEntry>({ classPrefix: p, entries, currentId, emptyLabel, deleteLabel, onSelect, onDelete, renderExtra, lockIcon, deleteIcon = "×", panel = false }: StyleProps & { entries: readonly H[]; currentId: string | null; emptyLabel: string; deleteLabel: string; onSelect: (entry: H) => void; onDelete: (entry: H, event: MouseEvent<HTMLButtonElement>) => void; renderExtra?: (entry: H) => ReactNode; lockIcon?: ReactNode; deleteIcon?: ReactNode; panel?: boolean }) {
  return <div className={`${p}-history-${panel ? "panel" : "dropdown"}`}>
    {entries.length === 0 && <div className={`${p}-history-empty`}>{emptyLabel}</div>}
    {entries.map(entry => {
      const item = <div className={`${p}-history-item ${currentId === entry.id ? "active" : ""}${entry.encrypted ? " encrypted" : ""}`} onClick={() => onSelect(entry)}>
        <div className={`${p}-history-title`}>{entry.encrypted && lockIcon}{entry.title}</div>
        <div className={`${p}-history-meta`}><span className={panel ? undefined : `${p}-history-date`}>{entry.dateLabel}</span><button className={`${p}-history-delete`} onClick={event => { event.stopPropagation(); onDelete(entry, event); }} title={deleteLabel}>{deleteIcon}</button></div>
      </div>;
      return renderExtra ? <div key={entry.id}>{item}{renderExtra(entry)}</div> : <Fragment key={entry.id}>{item}</Fragment>;
    })}
  </div>;
}

export function ChatHeader({ classPrefix: p, title, children }: StyleProps & { title?: ReactNode; children: ReactNode }) {
  return <div className={`${p}-chat-header`}>{title && <h3>{title}</h3>}<div className={`${p}-header-actions`}>{children}</div></div>;
}

export function InputArea({ classPrefix: p, modifiers, collapsed, beforeInput, accessories, composer, footer }: StyleProps & { modifiers?: readonly (string | false | undefined)[]; collapsed?: boolean; beforeInput?: ReactNode; accessories?: ReactNode; composer: ReactNode; footer?: ReactNode }) {
  return <div className={[`${p}-input-container`, ...(modifiers ?? [])].filter(Boolean).join(" ")}>
    {beforeInput}
    {!collapsed && <div className={`${p}-input-area`}>{accessories}{composer}</div>}
    {footer}
  </div>;
}

export interface ModelDropdownOption { value: string; label: string }

/** The small select used beside the model picker for effort, variants and the like. */
export function ModelDropdown({ classPrefix: p, value, options, onChange, title, disabled, className }: StyleProps & { value: string; options: readonly ModelDropdownOption[]; onChange: (value: string) => void; title: string; disabled?: boolean; className?: string }) {
  return <select className={[`${p}-model-dropdown`, className].filter(Boolean).join(" ")} value={value}
    onChange={event => onChange(event.target.value)} disabled={disabled} title={title} aria-label={title}>
    {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>;
}

/** The row under the composer: model picker, its dropdowns and the search selector. */
export function ModelRow({ classPrefix: p, label, children }: StyleProps & { label?: ReactNode; children: ReactNode }) {
  return <div className={`${p}-model-selector`}>
    {label !== undefined && <label className={`${p}-model-label`}>{label}</label>}
    {children}
  </div>;
}

export interface SearchSelectorProps extends StyleProps {
  /** Obsidian popout windows own their document, so hosts pass `activeDocument`. */
  ownerDocument: Document;
  labels: { webSearch: string; rag: (name: string) => string; ragNone: string; none: string };
  /**
   * Left out by hosts without a web search provider; RAG-only plugins pass nothing.
   *
   * `combinable` says whether this host can search the web and a RAG index in
   * the same turn. Where it cannot, picking one turns the other off here — the
   * host is told the whole selection, so it cannot end up holding a pair its
   * provider will not honour.
   */
  webSearch?: { checked: boolean; disabled: boolean; combinable: boolean };
  rag: { settings: readonly string[]; selected: string | null; disabled: boolean };
  /** The complete selection after the change, not just the part that moved. */
  onChange: (selection: SearchSelection) => void;
  disabled?: boolean;
}

/** One control for web search and RAG selection; RAG is off when nothing is selected. */
export function SearchSelector({ classPrefix: p, ownerDocument, labels, webSearch, rag, onChange, disabled }: SearchSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handleClick = (event: Event) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    ownerDocument.addEventListener("mousedown", handleClick);
    ownerDocument.addEventListener("keydown", handleEscape);
    // Land on the first choice the user can actually change.
    ownerDocument.defaultView?.setTimeout(() => menuRef.current?.querySelector<HTMLInputElement>("input:not(:disabled)")?.focus(), 0);
    return () => {
      ownerDocument.removeEventListener("mousedown", handleClick);
      ownerDocument.removeEventListener("keydown", handleEscape);
    };
  }, [open, ownerDocument]);

  const summary = webSearch?.checked && rag.selected ? `${labels.webSearch} + ${rag.selected}`
    : webSearch?.checked ? labels.webSearch
    : rag.selected ? labels.rag(rag.selected)
    : labels.none;
  const selectRag = (name: string | null) => onChange({
    webSearch: (webSearch?.checked ?? false) && (name === null || webSearch!.combinable),
    ragSetting: name,
  });
  const option = (key: string, label: string, input: ReactNode, muted: boolean) =>
    <label key={key} className={[`${p}-search-selector-option`, muted && "disabled"].filter(Boolean).join(" ")}>{input}<span>{label}</span></label>;

  return <div className={`${p}-search-selector`} ref={containerRef}>
    <button ref={buttonRef} type="button" className={`${p}-model-dropdown ${p}-rag-select ${p}-search-selector-button`}
      onClick={() => setOpen(!open)} disabled={disabled} aria-haspopup="menu" aria-expanded={open}>
      {summary}<ChevronDown size={13} aria-hidden="true" />
    </button>
    {open && <div className={`${p}-search-selector-menu`} role="menu" ref={menuRef}>
      {webSearch && <>
        {option("web", labels.webSearch, <input type="checkbox" checked={webSearch.checked} disabled={webSearch.disabled}
          onChange={event => onChange({
            webSearch: event.target.checked,
            ragSetting: event.target.checked && !webSearch.combinable ? null : rag.selected,
          })} />, webSearch.disabled)}
        <div className={`${p}-search-selector-separator`} />
      </>}
      {option("rag-none", labels.ragNone, <input type="radio" name={`${p}-rag-setting`} checked={rag.selected === null}
        disabled={rag.disabled} onChange={() => selectRag(null)} />, rag.disabled)}
      {rag.settings.map(name => option(`rag-${name}`, labels.rag(name), <input type="radio" name={`${p}-rag-setting`}
        checked={rag.selected === name} disabled={rag.disabled} onChange={() => selectRag(name)} />, rag.disabled))}
    </div>}
  </div>;
}

/** The hidden file input, the paperclip that opens it, and the row of accessory buttons beside it. */
export function InputButtons({ classPrefix: p, attach, children }: StyleProps & { attach: { title: string; accept: string; inputRef: Ref<HTMLInputElement>; disabled?: boolean; onOpenPicker: () => void; onSelect: (event: ChangeEvent<HTMLInputElement>) => void }; children?: ReactNode }) {
  return <>
    <input ref={attach.inputRef} type="file" multiple accept={attach.accept} onChange={attach.onSelect} className={`${p}-hidden-input`} />
    <div className={`${p}-input-buttons`}>
      <button className={`${p}-attachment-btn`} onClick={attach.onOpenPicker} disabled={attach.disabled} title={attach.title}><Paperclip size={18} /></button>
      {children}
    </div>
  </>;
}

/** Trigger for the vault tool menu; the host owns the open state and outside-click handling. */
export function VaultToolButton({ classPrefix: p, title, active, disabled, onClick, containerRef, children }: StyleProps & { title: string; active: boolean; disabled?: boolean; onClick: () => void; containerRef: Ref<HTMLDivElement>; children?: ReactNode }) {
  return <div className={`${p}-vault-tool-container`} ref={containerRef}>
    <button className={[`${p}-vault-tool-btn`, active && "active"].filter(Boolean).join(" ")} onClick={onClick} disabled={disabled} title={title}><Database size={18} /></button>
    {children}
  </div>;
}

/** How many earlier messages ride along with the next send; 0 means only the new one. */
export function HistoryLimit({ classPrefix: p, label, value, onChange, max = 99 }: StyleProps & { label: string; value: number; onChange: (count: number) => void; max?: number }) {
  return <>
    <div className={`${p}-vault-tool-separator`} />
    <label className={`${p}-vault-tool-checkbox`}>
      <span>{label}</span>
      <select value={value} onChange={event => onChange(Number(event.target.value))}>
        {Array.from({ length: max + 1 }, (_, count) => <option key={count} value={count}>{count}</option>)}
      </select>
    </label>
  </>;
}

/** A labelled group inside the vault tool menu, such as the MCP server list. */
export function VaultToolSection({ classPrefix: p, label, children }: StyleProps & { label: string; children: ReactNode }) {
  return <>
    <div className={`${p}-vault-tool-divider`} />
    <div className={`${p}-vault-tool-section-label`}>{label}</div>
    {children}
  </>;
}

/** `hint` and `toolsTitle` are required so every server says what it brings. */
export interface McpServerChoice { id: string; name: string; enabled: boolean; hint: string; toolsTitle: string }

export function McpServerToggles({ classPrefix: p, servers, onToggle, disabled }: StyleProps & { servers: readonly McpServerChoice[]; onToggle: (id: string, enabled: boolean) => void; disabled?: boolean }) {
  return <>{servers.map(server => <label key={server.id} className={[`${p}-mcp-server-item`, disabled && "is-disabled"].filter(Boolean).join(" ")} title={server.toolsTitle}>
    <input type="checkbox" checked={!disabled && server.enabled} onChange={event => onToggle(server.id, event.target.checked)} disabled={disabled} />
    <span className={`${p}-mcp-server-name`}>{server.name}</span>
    {server.hint && <span className={`${p}-mcp-tool-hint`}>{server.hint}</span>}
  </label>)}</>;
}

export interface EnabledMcpServer { id: string; name: string; title: string; removeTitle: string }

/** Chips for the servers currently in play, each removable without opening the menu. */
export function EnabledMcpServers({ classPrefix: p, servers, onDisable, disabled }: StyleProps & { servers: readonly EnabledMcpServer[]; onDisable: (id: string) => void; disabled?: boolean }) {
  if (servers.length === 0) return null;
  return <div className={`${p}-enabled-mcp-servers`}>{servers.map(server => <span key={server.id} className={`${p}-enabled-mcp-server`} title={server.title}>
    <Wrench size={12} aria-hidden="true" />
    <span className={`${p}-enabled-mcp-server-name`}>{server.name}</span>
    <button type="button" className={`${p}-enabled-mcp-server-remove`} onClick={() => onDisable(server.id)} disabled={disabled} title={server.removeTitle} aria-label={server.removeTitle}><X size={10} aria-hidden="true" /></button>
  </span>)}</div>;
}

/** `description` is required so a host cannot ship a mode whose meaning is unexplained. */
export interface VaultToolOption<T extends string = string> { id: T; label: ReactNode; description: ReactNode; selected?: boolean; disabled?: boolean }

/** Vault tool mode list; hosts own the trigger button, menu visibility and mode values. */
export function VaultToolMenu<T extends string>({ classPrefix: p, options, onSelect, children }: StyleProps & { options: readonly VaultToolOption<T>[]; onSelect: (id: T) => void; children?: ReactNode }) {
  return <div className={`${p}-vault-tool-menu`}>
    {options.map(option => <div key={option.id}
      className={[`${p}-vault-tool-item`, option.selected && "selected", option.disabled && "disabled"].filter(Boolean).join(" ")}
      onClick={option.disabled ? undefined : () => onSelect(option.id)}>
      <div>{option.label}</div>
      <div className={`${p}-vault-tool-item-desc`}>{option.description}</div>
    </div>)}
    {children}
  </div>;
}

export interface VaultToolModeChoice<T extends string> { id: T; label: string; description: string }

/**
 * The Vault tool button and the menu it opens: the access modes, the MCP
 * servers this chat may use, and how much history rides along.
 *
 * Composing it once is what keeps the modes consistent. Rendering them twice —
 * as menu items and again as <option>s for a second panel — is how one of them
 * lost its restriction in one plugin while the other panel kept it, and how a
 * host ended up hiding the history limit as soon as a server was configured.
 */
export function VaultToolControl<T extends string>({
  classPrefix: p, containerRef, title, open, onToggle, onOpen,
  modes, mode, onModeChange, lockedTo, disabled, mcp, historyLimit,
}: StyleProps & {
  containerRef: Ref<HTMLDivElement>;
  title: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  /** Runs when the menu is opened, for a host that refreshes what it shows. */
  onOpen?: () => void;
  /** Least restricted first: the button reads as inactive only on the first. */
  modes: readonly VaultToolModeChoice<T>[];
  mode: T;
  onModeChange: (mode: T) => void;
  /** The only mode selectable right now; the rest are shown but not choosable. */
  lockedTo?: T;
  disabled?: boolean;
  mcp?: { label: string; servers: readonly McpServerChoice[]; onToggle: (id: string, enabled: boolean) => void };
  historyLimit?: { label: string; value: number; onChange: (count: number) => void };
}) {
  const narrowed = mode !== modes[0]?.id || !!mcp?.servers.some(server => !server.enabled);
  return <VaultToolButton
    classPrefix={p}
    containerRef={containerRef}
    title={title}
    active={narrowed}
    disabled={disabled}
    onClick={() => {
      const next = !open;
      onToggle(next);
      if (next) onOpen?.();
    }}
  >
    {open && <VaultToolMenu<T>
      classPrefix={p}
      options={modes.map(choice => ({
        ...choice,
        selected: mode === choice.id,
        disabled: lockedTo !== undefined && choice.id !== lockedTo,
      }))}
      onSelect={next => { onModeChange(next); onToggle(false); }}
    >
      {mcp && mcp.servers.length > 0 && (
        <VaultToolSection classPrefix={p} label={mcp.label}>
          <McpServerToggles
            classPrefix={p}
            servers={mcp.servers}
            onToggle={mcp.onToggle}
            disabled={lockedTo !== undefined}
          />
        </VaultToolSection>
      )}
      {historyLimit && <HistoryLimit
        classPrefix={p}
        label={historyLimit.label}
        value={historyLimit.value}
        onChange={historyLimit.onChange}
      />}
    </VaultToolMenu>}
  </VaultToolButton>;
}

/** A source the reader can open: a note, a web result, a skill file. */
export interface SourceLink { label: string; title: string; onOpen: () => void }

/** "Used X" line above a message, with the sources it drew on. */
export function SourceBadges({ classPrefix: p, icon, label, sources }: StyleProps & { icon: string; label: string; sources?: readonly SourceLink[] }) {
  return <div className={`${p}-rag-used`}>
    <span className={`${p}-rag-indicator`}>{icon} {label}</span>
    {sources && sources.length > 0 && <div className={`${p}-rag-sources`}>
      {sources.map((source, index) => <span key={index} className={`${p}-rag-source ${p}-tool-clickable`} onClick={source.onOpen} title={source.title}>{source.label}</span>)}
    </div>}
  </div>;
}

/** The tool indicators under a message, plus the hint shown when one of them failed. */
export function ToolsUsed({ classPrefix: p, errorHint, children }: StyleProps & { errorHint?: string; children: ReactNode }) {
  return <>
    <div className={`${p}-tools-used`}>{children}</div>
    {errorHint && <div className={`${p}-workflow-error-hint`}>{errorHint}</div>}
  </>;
}

/** `title` is required so a chip always says what it is, clickable or not. */
export interface SkillChip { name: string; title: string; open?: { onOpen: () => void } }

/** The skills that shaped a message; vault skills open their SKILL.md, bundled ones stay static. */
export function SkillsUsed({ classPrefix: p, label, skills }: StyleProps & { label: string; skills: readonly SkillChip[] }) {
  return <div className={`${p}-skills-used`}>
    <span className={`${p}-skills-indicator`}>✨ {label}:</span>
    {skills.map((skill, index) => <span key={index}
      className={`${p}-skill-chip${skill.open ? ` ${p}-tool-clickable` : " is-static"}`}
      onClick={skill.open?.onOpen} title={skill.title}>{skill.name}</span>)}
  </div>;
}

export function ToolIndicator({ classPrefix: p, icon, label, detail, onClick, workflowAction }: StyleProps & { icon: ReactNode; label: string; detail: string; onClick: () => void; workflowAction?: { label: string; title: string; onClick: () => void } }) {
  return <span className={`${p}-tool-indicator-group`}>
    <span className={`${p}-tool-indicator ${p}-tool-clickable`} onClick={onClick} title={detail}>{icon} {label}</span>
    {workflowAction && <button className={`${p}-tool-open-workflow-btn`} onClick={workflowAction.onClick} title={workflowAction.title}>📂 {workflowAction.label}</button>}
  </span>;
}

export { ModelSelector, filterModelOptions, type ModelOption, type ModelSelectorProps } from "./ModelSelector.js";
export { ChipSelector, type ChipChoice, type ChipSelectorProps } from "./ChipSelector.js";

export function CollapsedInput({ classPrefix: p, label, onExpand }: StyleProps & { label: string; onExpand: () => void }) {
  return <div className={`${p}-collapsed-bar`}><button className={`${p}-expand-btn`} onClick={onExpand} title={label}><ChevronUp size={18} /></button></div>;
}
