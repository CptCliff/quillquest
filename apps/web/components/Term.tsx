'use client';
import { useId, useState, type ReactNode } from 'react';
import { GLOSSARY, type TermKey } from '../lib/glossary';

/** A word the game defines: tap it to read what it means, in place. Use in headings and help text, not inside a form label. */
export function Term({ k, children }: { k: TermKey; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const entry = GLOSSARY[k];
  return (
    <span className="term">
      <button type="button" className="term-word" aria-expanded={open} aria-controls={id} data-testid={`term-${k}`} onClick={() => setOpen(!open)}>{children ?? entry.term}</button>
      {open && <span id={id} role="note" className="term-def" data-testid={`term-def-${k}`}><strong>{entry.term}.</strong> {entry.text}</span>}
    </span>
  );
}
