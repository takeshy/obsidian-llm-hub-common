import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";
import type { StyleProps } from "./types.js";

/** `description` is required so every choice explains itself in the dropdown. */
export interface ChipChoice {
  id: string;
  name: string;
  description: ReactNode;
  chipTitle: string;
  badge?: ReactNode;
  removeTitle?: string;
  /** Present when the chip links somewhere; static chips (built-ins) leave it out. */
  open?: { title: string; onOpen: () => void };
}

export interface ChipSelectorProps extends StyleProps {
  /** Obsidian popout windows own their document, so hosts pass `activeDocument`. */
  ownerDocument: Document;
  /** Rendered inside the shared icon wrapper, so hosts pass a bare lucide icon. */
  icon: ReactNode;
  addLabel: string;
  choices: readonly ChipChoice[];
  activeIds: readonly string[];
  onToggle: (id: string) => void;
  className?: string;
  disabled?: boolean;
}

/** Chips plus a portalled checklist, shared by skill and OKF selection. */
export function ChipSelector({ classPrefix: p, ownerDocument, icon, addLabel, choices, activeIds, onToggle, className, disabled }: ChipSelectorProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  /** Position the dropdown above the selector, matching its full width. */
  const updatePosition = useCallback(() => {
    const dropdown = dropdownRef.current, selector = selectorRef.current, view = ownerDocument.defaultView;
    if (!dropdown || !selector || !view) return;
    const rect = selector.getBoundingClientRect();
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.width = `${rect.width}px`;
    dropdown.style.bottom = `${view.innerHeight - rect.top + 4}px`;
  }, [ownerDocument]);

  useEffect(() => {
    if (!showDropdown) return;
    const handleClick = (event: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(event.target as Node)
        && dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setShowDropdown(false);
    };
    const view = ownerDocument.defaultView;
    ownerDocument.addEventListener("mousedown", handleClick);
    view?.requestAnimationFrame(updatePosition);
    view?.addEventListener("resize", updatePosition);
    return () => {
      ownerDocument.removeEventListener("mousedown", handleClick);
      view?.removeEventListener("resize", updatePosition);
    };
  }, [showDropdown, updatePosition, ownerDocument]);

  if (choices.length === 0) return null;
  return <div className={`${p}-skill-selector${className ? ` ${className}` : ""}`} ref={selectorRef}>
    <span className={`${p}-skill-icon`}>{icon}</span>
    {choices.filter(choice => activeIds.includes(choice.id)).map(choice => <span key={choice.id} className={`${p}-skill-chip`} title={choice.chipTitle}>
      {choice.open
        ? <span className={`${p}-skill-chip-name ${p}-tool-clickable`} onClick={choice.open.onOpen} title={choice.open.title}>{choice.name}</span>
        : <span className={`${p}-skill-chip-name is-static`}>{choice.name}</span>}
      <button className={`${p}-skill-chip-remove`} onClick={() => onToggle(choice.id)} disabled={disabled} title={choice.removeTitle}><X size={10} /></button>
    </span>)}
    <button className={`${p}-skill-add-btn`} onClick={() => setShowDropdown(!showDropdown)} disabled={disabled} title={addLabel}><Plus size={12} /></button>
    {showDropdown && createPortal(
      <div className={`${p}-skill-dropdown`} ref={dropdownRef}>
        {choices.map(choice => <label key={choice.id} className={`${p}-skill-dropdown-item`}>
          <input type="checkbox" checked={activeIds.includes(choice.id)} onChange={() => onToggle(choice.id)} disabled={disabled} />
          <div className={`${p}-skill-dropdown-info`}>
            <span className={`${p}-skill-dropdown-name`}>{choice.name}{choice.badge && <span className={`${p}-skill-builtin-badge`}>{choice.badge}</span>}</span>
            {choice.description && <span className={`${p}-skill-dropdown-desc`}>{choice.description}</span>}
          </div>
        </label>)}
      </div>,
      ownerDocument.body,
    )}
  </div>;
}
