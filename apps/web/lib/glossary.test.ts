import { describe, expect, it } from 'vitest';
import { GLOSSARY } from './glossary';

describe('the glossary', () => {
  const entries = Object.entries(GLOSSARY);
  it('defines each word once, in a sentence or two of plain language', () => {
    expect(new Set(entries.map(([, e]) => e.term)).size).toBe(entries.length);
    for (const [k, e] of entries) {
      expect(e.text.length, k).toBeGreaterThan(20);
      expect(e.text.length, k).toBeLessThan(260);
    }
  });
  it('never shows dice or numeric odds: players see rank words, and dice only in the reveal', () => {
    for (const [k, e] of entries) expect(`${e.term} ${e.text}`, k).not.toMatch(/\bd\d+\b|\bdie\b|\bdice\b|\d+%/i);
  });
  it('covers the words playtesters said they could not find', () => {
    for (const k of ['thread', 'capital', 'canon', 'conviction', 'burden', 'wound', 'spotlight', 'set', 'drafting', 'quick', 'concede', 'veteran', 'swap', 'object', 'odds'])
      expect(GLOSSARY, k).toHaveProperty(k);
  });
});
