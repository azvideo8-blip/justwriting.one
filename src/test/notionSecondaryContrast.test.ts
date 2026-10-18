// Ревью ui-unify 2026-10-18: второстепенный текст — `text-main/60` (U-3). В светлой
// теме notion он обязан держать AA (4,5:1) на каждой поверхности, где лежит текст,
// включая листы (`--surface-popup`): на #1A1412 там было 4,35.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('src/index.css', 'utf8');
const block = css.slice(css.indexOf('.theme-notion {'), css.indexOf('}', css.indexOf('.theme-notion {')));
type RGB = [number, number, number];
const token = (name: string): string => {
  const m = block.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m?.[1]) throw new Error(`--${name} не найден в .theme-notion`);
  return m[1];
};
const rgb = (hex: string): RGB => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as RGB;
const lum = ([r, g, b]: RGB) => {
  const ch = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
};
const ratio = (a: RGB, b: RGB) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

describe('notion: text-main/60 держит AA', () => {
  it.each(['bg-base', 'surface-card', 'surface-popup'])('на --%s', surface => {
    const fg = rgb(token('text-main'));
    const bg = rgb(token(surface));
    const mixed = fg.map((v, i) => Math.round(v * 0.6 + bg[i]! * 0.4)) as RGB;
    expect(ratio(mixed, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
