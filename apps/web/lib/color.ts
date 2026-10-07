/** Small colour helpers: WCAG contrast, an sRGB mix like CSS `color-mix(in srgb, ...)`, and the readable text colour for a background. */
export type Rgb = [number, number, number];
export const parseHex = (hex: string): Rgb => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
};
export const toHex = ([r, g, b]: Rgb): string => `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;

const lin = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
export const luminance = (hex: string): number => { const [r, g, b] = parseHex(hex); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
/** WCAG 2 contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
/** `color-mix(in srgb, a (100-pct)%, b)`: pct percent of `b` mixed into `a`. */
export function mix(a: string, b: string, pct: number): string {
  const [x, y] = [parseHex(a), parseHex(b)];
  return toHex(x.map((v, i) => v * (1 - pct / 100) + y[i]! * (pct / 100)) as Rgb);
}
/** Black or white, whichever reads better on this background. */
export const readableOn = (bg: string): '#ffffff' | '#111111' => (contrast(bg, '#ffffff') >= contrast(bg, '#111111') ? '#ffffff' : '#111111');
