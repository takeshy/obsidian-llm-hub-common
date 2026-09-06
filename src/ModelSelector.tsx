import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

export interface ModelOption { value: string; label: string; keywords?: string }
export function filterModelOptions<T extends ModelOption>(models: readonly T[], query: string): T[] {
  const seen = new Set<string>();
  const normalized = query.trim().toLowerCase();
  return models.filter(model => {
    if (seen.has(model.value)) return false;
    seen.add(model.value);
    return !normalized || [model.value, model.label, model.keywords ?? ""].some(text => text.toLowerCase().includes(normalized));
  });
}
export interface ModelSelectorProps {
  classPrefix: string;
  models: readonly ModelOption[];
  value: string;
  onChange: (model: string) => void;
  disabled?: boolean;
  filterLabel: string;
  emptyLabel: string;
}
export function ModelSelector({ classPrefix: p, models, value, onChange, disabled, filterLabel, emptyLabel }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const filteredModels = useMemo(() => filterModelOptions(models, query), [models, query]);
  useEffect(() => {
    if (!open) return;
    const ownerDocument = rootRef.current?.ownerDocument;
    const ownerWindow = ownerDocument?.defaultView;
    const onOutside = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    ownerDocument?.addEventListener("mousedown", onOutside);
    const frame = ownerWindow?.requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      ownerDocument?.removeEventListener("mousedown", onOutside);
      if (frame !== undefined) ownerWindow?.cancelAnimationFrame(frame);
    };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => { setSelectedIndex(0); }, [query]);
  useEffect(() => { (listRef.current?.children[selectedIndex] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" }); }, [selectedIndex]);
  const select = (model: ModelOption) => { if (disabled) return; onChange(model.value); setQuery(""); setOpen(false); };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setSelectedIndex(index => Math.max(0, Math.min(index + 1, filteredModels.length - 1))); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setSelectedIndex(index => Math.max(index - 1, 0)); }
    else if (event.key === "Enter" && filteredModels[selectedIndex]) { event.preventDefault(); select(filteredModels[selectedIndex]); }
    else if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
  };
  return <div className={`${p}-model-picker`} ref={rootRef}>
    <button type="button" className={`${p}-model-picker-trigger`} disabled={disabled} aria-haspopup="listbox" aria-expanded={open && !disabled} title={value} onClick={() => { setQuery(""); setSelectedIndex(0); setOpen(current => !current); }}>
      <span>{models.find(model => model.value === value)?.label ?? value}</span><ChevronDown size={11} aria-hidden="true" />
    </button>
    {open && !disabled && <div className={`${p}-model-picker-popover`}>
      <div className={`${p}-model-picker-search`}><Search size={13} aria-hidden="true" /><input ref={inputRef} type="text" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={onKeyDown} placeholder={filterLabel} aria-label={filterLabel} /></div>
      <div className={`${p}-model-picker-list`} role="listbox" ref={listRef}>
        {filteredModels.length ? filteredModels.map((model, index) => <button type="button" key={model.value} className={`${p}-model-picker-option${index === selectedIndex ? " is-selected" : ""}`} onClick={() => select(model)} onMouseEnter={() => setSelectedIndex(index)} role="option" aria-selected={model.value === value} title={model.value}>
          <span>{model.label}</span>{model.value === value && <Check size={13} aria-hidden="true" />}
        </button>) : <div className={`${p}-model-picker-empty`}>{emptyLabel}</div>}
      </div>
    </div>}
  </div>;
}
