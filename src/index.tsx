import { Fragment, type ReactNode, type Ref, type TextareaHTMLAttributes, type MouseEvent } from "react";
import { BookOpen, LayoutDashboard, Plus, Copy, Check, Send, StopCircle, Loader2, ChevronUp, ChevronDown } from "lucide-react";

export interface ChatMessage {
  role: string;
  content: string;
  timestamp: number;
  thinking?: string;
}
export interface StyleProps { classPrefix: string }

/** The host owns lifecycle, persistence and provider execution. */
export function ChatLayout({ className, children }: { className: string; children: ReactNode }) {
  return <div className={className}>{children}</div>;
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

export interface AttachmentDisplay { type: string; name: string }
const attachmentIcons: Record<string, string> = { image: "🖼️", pdf: "📄", text: "📃", audio: "🎵", video: "🎬" };
export function Attachments({ classPrefix: p, attachments, pending, removeLabel, onRemove, onOpen }: StyleProps & { attachments?: readonly AttachmentDisplay[]; pending?: boolean; removeLabel?: string; onRemove?: (index: number) => void; onOpen?: (index: number) => void }) {
  if (!attachments?.length) return null;
  const itemClass = `${p}-${pending ? "pending-" : ""}attachment`;
  return <div className={`${itemClass}s`}>{attachments.map((item, index) => <span key={index} className={itemClass} onClick={onOpen ? () => onOpen(index) : undefined}>
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

export function InputArea({ classPrefix: p, className, collapsed, beforeInput, accessories, composer, footer }: StyleProps & { className?: string; collapsed?: boolean; beforeInput?: ReactNode; accessories?: ReactNode; composer: ReactNode; footer?: ReactNode }) {
  return <div className={className ?? `${p}-input-container`}>
    {beforeInput}
    {!collapsed && <div className={`${p}-input-area`}>{accessories}{composer}</div>}
    {footer}
  </div>;
}

export function ToolIndicator({ classPrefix: p, icon, label, detail, onClick, workflowAction }: StyleProps & { icon: ReactNode; label: string; detail: string; onClick: () => void; workflowAction?: { label: string; title: string; onClick: () => void } }) {
  return <span className={`${p}-tool-indicator-group`}>
    <span className={`${p}-tool-indicator ${p}-tool-clickable`} onClick={onClick} title={detail}>{icon} {label}</span>
    {workflowAction && <button className={`${p}-tool-open-workflow-btn`} onClick={workflowAction.onClick} title={workflowAction.title}>📂 {workflowAction.label}</button>}
  </span>;
}

export { ModelSelector, filterModelOptions, type ModelOption, type ModelSelectorProps } from "./ModelSelector.js";

export function CollapsedInput({ classPrefix: p, label, onExpand }: StyleProps & { label: string; onExpand: () => void }) {
  return <div className={`${p}-collapsed-bar`}><button className={`${p}-expand-btn`} onClick={onExpand} title={label}><ChevronUp size={18} /></button></div>;
}
