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

    // DC-A1: счётчик дней в группе архива красится в --brand-soft темы.
    // Старый цвет — корневой #A583E8 с opacity-50: на светлом «Тёплом» ≈ 1.7:1.
    it(`${name}: day-group count (brand-soft on bg-base) ≥ 4.5:1`, () => {
      const brand = varIn(block!, 'brand-soft') ?? rootBrand;
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

describe('DC-A1: cascade layering and day-group count markup', () => {
  it(':root defaults of theme variables live inside @layer base', () => {
    // Блоки считаются по скобкам, комментарии вырезаны: два indexOf попадали в
    // комментарий, слайс выходил пустым, и проверка не могла покраснеть (R3-015).
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const blocks: { sel: string; ctx: string[]; body: string }[] = [];
    const stack: { sel: string; start: number }[] = [];
    let sel = '';
    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i];
      if (ch === '{') { stack.push({ sel: sel.trim(), start: i + 1 }); sel = ''; }
      else if (ch === '}') {
        const top = stack.pop();
        if (top) blocks.push({ sel: top.sel, ctx: stack.map(b => b.sel), body: clean.slice(top.start, i) });
        sel = '';
      } else if (ch === ';') sel = '';
      else sel += ch;
    }
    const varsOf = (body: string) => [...body.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]!);
    const themeVars = new Set(blocks.filter(b => b.sel.startsWith('.theme-')).flatMap(b => varsOf(b.body)));
    expect(themeVars.size).toBeGreaterThan(0);
    const roots = blocks.filter(b => b.sel === ':root' && varsOf(b.body).some(v => themeVars.has(v)));
    expect(roots.length).toBeGreaterThan(0);
    for (const r of roots) expect(r.ctx).toContain('@layer base');
  });

  it('day-group count uses the token class, no arbitrary var() and no opacity', () => {
    const hits = execSync(
      `grep -rn --include='*.tsx' -E 'text-\\[var\\(--brand-soft\\)\\]' ${resolve(__dirname, '..')} || true`,
      { encoding: 'utf8' }
    ).trim();
    expect(hits).toBe('');
    const list = readFileSync(
      resolve(__dirname, '../features/archive/components/ArchiveNoteList.tsx'),
      'utf8'
    );
    for (const line of list.split('\n').filter(l => l.includes('text-brand-soft'))) {
      expect(line).not.toContain('opacity-');
      expect(line).not.toContain('font-mono');
    }
  });
});
