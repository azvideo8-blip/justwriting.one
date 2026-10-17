import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// R7F-026: класс `bg-accent` встречался в 17 местах (кнопки на страницах
// приглашения и сброса пароля), а токена `--color-accent` не было ни в `@theme`,
// ни в собранном CSS — Tailwind не генерировал правило, и кнопка рисовалась
// белым текстом без фона (в `theme-notion` — белым по белому). Оба цветовых
// гейта этого не видели: MF-24 ловит только `white/`, `black/`, `rgba(` и `#hex`,
// MF-18 — только `var(--x)` в CSS.
//
// Гейт: у каждого класса `bg|text|border|ring|…-<токен>`, где токен принадлежит
// фирменным семействам приложения, обязан быть `--color-<токен>` в `src/index.css`.
const root = process.cwd();
const SRC = join(root, 'src');
const CSS = join(root, 'src/index.css');

/** Семейства токенов, которые приложение объявляет само (в `@theme`). */
const TOKEN_FAMILIES = new Set(['accent', 'brand', 'surface', 'text', 'border', 'panel']);
const CLASS_RE = /\b(?:bg|text|border|ring|fill|stroke|outline|shadow|decoration|from|via|to|caret)-((?:accent|brand|surface|text|border|panel)(?:-[a-z0-9-]+)?)(?=[\s"'`/\]])/g;

/**
 * Храповик долга (R7Q-036): эти мёртвые токены найдены тем же гейтом и оставлены
 * до отдельной правки — объявить их значит **добавить цвет туда, где сейчас он не
 * рисуется вовсе**, то есть изменить вид компонентов без просмотра владельцем.
 * Список имеет право только сохнуть: новый токен — красный тест, ставшийся — тоже
 * (его надо вычеркнуть).
 */
// N-8 (R7 T-16): долг закрыт — четыре мёртвых токена либо объявлены там, где
// должны работать (brand-soft-hover), либо заменены живым токеном (accent-main →
// accent, border-light → border-subtle, text-primary → text-main). Пустой набор
// — это и есть проверка: любой новый фирменный класс без токена краснеет сразу.
const DEAD_TOKEN_BASELINE = new Set<string>([]);

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      out.push(...tsxFiles(full));
    } else if (/\.tsx$/.test(entry) && !entry.includes('.test.')) {
      out.push(full);
    }
  }
  return out;
}

function collectMissing(defined: Set<string>): Map<string, string> {
  const missing = new Map<string, string>();
  for (const file of tsxFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(CLASS_RE)) {
      const token = m[1];
      if (!token || !TOKEN_FAMILIES.has(token.split('-')[0]!)) continue;
      if (defined.has(token) || DEAD_TOKEN_BASELINE.has(token)) continue;
      const line = text.slice(0, m.index).split('\n').length;
      if (!missing.has(token)) missing.set(token, `${relative(root, file)}:${line}`);
    }
  }
  return missing;
}

describe('R7F-026: каждый фирменный цветовой класс имеет токен в @theme', () => {
  const css = readFileSync(CSS, 'utf8');
  const defined = new Set([...css.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map(m => m[1]!));

  it('токены объявлены — в том числе угловой из находки', () => {
    expect(defined.has('accent'), '--color-accent должен быть в @theme').toBe(true);
    expect(css).toMatch(/--color-accent:\s*var\(--brand-primary\)/);
    expect(defined.has('accent-danger')).toBe(true);
    expect(defined.has('brand-soft')).toBe(true);
  });

  it('в src нет ни одного класса с необъявленным фирменным токеном сверх долга', () => {
    const missing = collectMissing(defined);
    const list = [...missing.entries()].map(([t, where]) => `${t} (${where})`).join('\n');
    expect(missing.size, `новых мёртвых токенов: ${missing.size}\n${list}`).toBe(0);
  });

  it('гейт не холостой: без токена в CSS находка краснеет, а долг из baseline не глушит проверку', () => {
    // 1) вычёркиваем `accent` из объявленных — `bg-accent` обязан пойматься.
    const withoutAccent = new Set(defined);
    withoutAccent.delete('accent');
    const caught = collectMissing(withoutAccent);
    expect(caught.has('accent'), 'bg-accent без --color-accent должен ловиться').toBe(true);

    // 2) посадить новый мёртвый токен — тот же сборщик его видит.
    const withPlanted = new Set(defined);
    withPlanted.delete('brand-soft');
    expect(collectMissing(withPlanted).has('brand-soft')).toBe(true);
  });

  it('список долга сократился — вычеркните его из baseline', () => {
    const stillDead = [...DEAD_TOKEN_BASELINE].filter(t => !defined.has(t));
    expect(stillDead.length, `в baseline мёртвых токенов: ${stillDead.join(', ')}`).toBe(DEAD_TOKEN_BASELINE.size);
  });
});
