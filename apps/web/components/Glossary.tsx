'use client';
import { useEffect, useRef, useState } from 'react';
import { GLOSSARY } from '../lib/glossary';

const GROUPS = ['Making a character', 'Rolling', 'Beliefs and what they cost', 'The table'] as const;

/** Every word the game defines, in one place: a header button that opens a dialog. Escape closes it and focus returns to the button. */
export function Glossary() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) closeRef.current?.focus(); }, [open]);
  const close = () => { setOpen(false); setFilter(''); openerRef.current?.focus(); };
  const q = filter.trim().toLowerCase();
  const entries = Object.entries(GLOSSARY).filter(([, e]) => !q || e.term.toLowerCase().includes(q) || e.text.toLowerCase().includes(q));
  return (
    <>
      <button type="button" ref={openerRef} className="quiet" data-testid="glossary-open" aria-haspopup="dialog" onClick={() => setOpen(true)}>Words</button>
      {open && (
        <div className="glossary-backdrop" onClick={close}>
          <section role="dialog" aria-modal="true" aria-label="What the words mean" className="glossary" data-testid="glossary"
            onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') close(); }}>
            <header>
              <h2>What the words mean</h2>
              <button type="button" ref={closeRef} data-testid="glossary-close" onClick={close}>Close</button>
            </header>
            <label className="field"><span>Find a word</span><input value={filter} data-testid="glossary-filter" onChange={(e) => setFilter(e.target.value)} /></label>
            {GROUPS.map((g) => {
              const rows = entries.filter(([, e]) => e.group === g);
              return rows.length ? (
                <div key={g}>
                  <h3>{g}</h3>
                  <dl>{rows.map(([k, e]) => <div key={k} data-testid={`glossary-${k}`}><dt>{e.term}</dt><dd>{e.text}</dd></div>)}</dl>
                </div>
              ) : null;
            })}
            {entries.length === 0 && <p className="muted">No word matches that.</p>}
          </section>
        </div>
      )}
    </>
  );
}
