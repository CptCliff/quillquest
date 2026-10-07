import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PALETTE } from '@quillquest/db/colors';
import { contrast, mix, readableOn } from '../lib/color';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

/** The declarations inside the first block whose selector is exactly `selector` (braces matched, so media-query nesting is fine). */
function block(selector: string): Record<string, string> {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no block ${selector}`);
  let depth = 0; let end = at;
  for (let i = css.indexOf('{', at); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) { end = i; break; }
  }
  const body = css.slice(css.indexOf('{', at) + 1, end);
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}
const light = block(':root');
const dark = block(`:root[data-theme='dark']`);
const system = block(`:root:not([data-theme='light'])`);
const themes = { light, dark } as const;

describe('design tokens', () => {
  it('the system dark block and the manual dark block are the same set of values', () => {
    for (const [k, v] of Object.entries(dark)) expect(system[k], k).toBe(v);
    expect(Object.keys(system).sort()).toEqual(Object.keys(dark).sort());
  });
  for (const [name, t] of Object.entries(themes)) {
    describe(`${name} theme`, () => {
      const v = (k: string) => (t[k] ?? light[k])!;
      const surfaces = ['surface', 'surface-raised', 'surface-sunken'];
      it('body and muted text meet 4.5:1 on every surface', () => {
        for (const s of surfaces) {
          expect(contrast(v('text'), v(s)), `text on ${s}`).toBeGreaterThanOrEqual(4.5);
          expect(contrast(v('text-muted'), v(s)), `muted on ${s}`).toBeGreaterThanOrEqual(4.5);
        }
      });
      it('the accent works as a button fill (4.5:1 for its label), as text, and the focus ring is visible on every surface (3:1)', () => {
        expect(contrast(v('text-on-accent'), v('accent'))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(v('text-on-accent'), v('accent-hover'))).toBeGreaterThanOrEqual(4.5);
        for (const s of surfaces) {
          expect(contrast(v('accent'), v(s)), `accent on ${s}`).toBeGreaterThanOrEqual(3);
          expect(contrast(v('focus'), v(s)), `focus on ${s}`).toBeGreaterThanOrEqual(3);
          expect(contrast(v('border-strong'), v(s)), `control border on ${s}`).toBeGreaterThanOrEqual(3);
        }
      });
      it('inserted, deleted and notice text are readable on their own backgrounds', () => {
        for (const [bg, fg] of [['ok-bg', 'ok-fg'], ['bad-bg', 'bad-fg'], ['warn-bg', 'warn-fg']]) expect(contrast(v(fg!), v(bg!)), fg).toBeGreaterThanOrEqual(4.5);
      });
      it('every writer\'s ink is a visible line or dot on the surfaces (3:1) once the theme\'s lift is applied', () => {
        const lift = Number.parseFloat(v('ink-lift'));
        for (const ink of PALETTE) for (const s of surfaces) expect(contrast(mix(ink, '#ffffff', lift), v(s)), `${ink} on ${s}`).toBeGreaterThanOrEqual(3);
      });
    });
  }
  it('text on an ink-coloured pill or caret label is always readable (the readable colour is chosen per ink)', () => {
    for (const ink of PALETTE) expect(contrast(ink, readableOn(ink)), ink).toBeGreaterThanOrEqual(4.5);
    expect(readableOn('#ffffff')).toBe('#111111');
    expect(readableOn('#000000')).toBe('#ffffff');
  });
});
