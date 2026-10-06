import type { Actor, Cell, Paragraph, SuggestionRef } from '../src';

/** Build a paragraph from plain text. Pass `ins`/`del` to mark spans as suggestions. */
export function para(
  id: string,
  authorId: string,
  text: string,
  opts: { locked?: boolean; pov?: string; ins?: [string, SuggestionRef][]; del?: [string, SuggestionRef][] } = {},
): Paragraph {
  const cells: Cell[] = [];
  for (const ch of text) cells.push({ ch, ins: null, del: null, fmt: '' });
  const out: Cell[] = [...cells];
  for (const [t, ref] of opts.ins ?? []) for (const ch of t) out.push({ ch, ins: ref, del: null, fmt: '' });
  for (const [t, ref] of opts.del ?? []) {
    // mark the first occurrence of t in the base text as deleted
    const base = cells.map((c) => c.ch).join('');
    const at = base.indexOf(t);
    for (let i = 0; i < t.length; i++) out[at + i] = { ...out[at + i]!, del: ref };
  }
  return { paragraphId: id, authorId, pov: opts.pov ?? 'own', locked: opts.locked ?? false, cells: out };
}
export const ref = (id: string, authorId: string): SuggestionRef => ({ id, authorId });
export const ilse: Actor = { id: 'ilse', role: 'player' };
export const sella: Actor = { id: 'sella', role: 'player' };
export const gm: Actor = { id: 'gm1', role: 'gm' };
