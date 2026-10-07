/** Distinguishable inks that read on both a light and a dark page. */
export const PALETTE = [
  '#c2410c', '#1d4ed8', '#7e22ce', '#15803d', '#0e7490', '#be123c',
  '#b45309', '#4d7c0f', '#a21caf', '#0f766e', '#4338ca', '#854d0e',
] as const;

const HEX = /^#[0-9a-f]{6}$/i;
export const isHexColor = (c: unknown): c is string => typeof c === 'string' && HEX.test(c);

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const distance = (a: string, b: string) => { const [x, y] = [rgb(a), rgb(b)]; return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };

function hslHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * An ink for a new member (design plan 9.1): the preferred color if it is free; otherwise the nearest free palette color;
 * with no preference, the first free palette color. Past the palette, spaced hues. Comparison ignores case.
 */
export function pickColor(taken: string[], preferred?: string | null): string {
  const used = new Set(taken.map((c) => c.toLowerCase()));
  const pref = isHexColor(preferred) ? preferred.toLowerCase() : null;
  if (pref && !used.has(pref)) return pref;
  const free = PALETTE.filter((c) => !used.has(c));
  if (free.length) return pref ? free.reduce((best, c) => (distance(c, pref) < distance(best, pref) ? c : best)) : free[0]!;
  for (let i = 0; ; i++) {
    const c = hslHex((i * 137.508) % 360, 62, 38);
    if (!used.has(c)) return c;
  }
}
