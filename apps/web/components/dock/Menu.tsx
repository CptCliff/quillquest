'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export type MenuItem =
  | { kind: 'item'; id: string; label: string; onSelect: () => void; checked?: boolean; disabled?: boolean }
  | { kind: 'heading'; id: string; label: string }
  | { kind: 'separator'; id: string };

/** A button that opens a menu: arrow keys move, Enter or Space chooses, Escape closes and returns focus to the button, a click outside closes. */
export function Menu({ label, trigger, items, testId, align = 'left' }: { label: string; trigger: ReactNode; items: MenuItem[]; testId: string; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const focusables = () => [...(list.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? [])];

  useEffect(() => {
    if (!open) return;
    focusables()[0]?.focus();
    const away = (e: PointerEvent) => { if (!list.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const close = (refocus: boolean) => { setOpen(false); if (refocus) button.current?.focus(); };
  const onKey = (e: React.KeyboardEvent) => {
    const els = focusables();
    const at = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'Tab') close(false);
    else if (e.key === 'ArrowDown') { e.preventDefault(); els[(at + 1) % els.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(at - 1 + els.length) % els.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); els[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); els.at(-1)?.focus(); }
  };

  return (
    <span className="menu" data-align={align}>
      <button ref={button} type="button" className="quiet menu-button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={label} data-testid={testId}
        onClick={() => setOpen((o) => !o)} onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}>{trigger}</button>
      {open && (
        <div ref={list} id={id} role="menu" aria-label={label} className="menu-list" onKeyDown={onKey}>
          {items.map((it) => it.kind === 'separator' ? <hr key={it.id} role="separator" />
            : it.kind === 'heading' ? <div key={it.id} className="menu-heading" role="presentation">{it.label}</div>
            : (
              <button key={it.id} type="button" role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={it.checked} aria-disabled={it.disabled || undefined} tabIndex={-1}
                data-testid={`${testId}-${it.id}`} onClick={() => { if (it.disabled) return; it.onSelect(); close(true); }}>
                {it.checked !== undefined && <span aria-hidden="true" className="menu-check">{it.checked ? '✓' : ''}</span>}{it.label}
              </button>
            ))}
        </div>
      )}
    </span>
  );
}
