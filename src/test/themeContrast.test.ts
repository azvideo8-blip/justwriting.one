import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

/**
 * N-55: основные кнопки — фон `bg-brand-soft`, текст `text-surface-base`
 * (= --bg-base темы). В каждой теме это сочетание обязано держать WCAG AA для
 * обычного текста — 4.5:1. В светлой теме «Тёплый» было 2.8:1.
 */
const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');

function lum(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
const varIn = (block: string, name: string) => new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(block)?.[1];

const rootBrand = varIn(css, 'brand-soft')!;
const themes = [...css.matchAll(/\.theme-([a-z]+)\s*\{([^}]*)\}/g)].filter(m => varIn(m[2]!, 'bg-base'));

describe('primary button contrast in every theme', () => {
  it('finds the themes', () => { expect(themes.length).toBeGreaterThanOrEqual(5); });
  for (const [, name, block] of themes) {
    it(`${name}: brand button text ≥ 4.5:1`, () => {
      // N-72: проверяем --color-brand-soft (его ест Tailwind) с фолбэком на --brand-soft
      const brand = varIn(block!, 'color-brand-soft') ?? varIn(block!, 'brand-soft') ?? rootBrand;
      expect(ratio(brand, varIn(block!, 'bg-base')!)).toBeGreaterThanOrEqual(4.5);
    });
  }

  // Белый текст на фиолетовом давал 3.0:1 во всех тёмных темах — такие кнопки
  // должны брать цвет текста темы, как остальные основные кнопки.
  // N-72: проверка на сплошной bg-brand-soft и градиент from-brand-soft с text-white.
  it('no primary button puts white text on the brand colour', () => {
    const hits = execSync(
      `grep -rn --include='*.tsx' -E "(bg-brand-soft.*text-white|text-white.*bg-brand-soft|from-brand-soft.*text-white|text-white.*from-brand-soft)" ${resolve(__dirname, '..')} || true`,
      { encoding: 'utf8' }
    ).trim();
    expect(hits).toBe('');
  });
});
