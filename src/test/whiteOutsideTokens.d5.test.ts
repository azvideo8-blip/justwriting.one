import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// D-5: белые цвета, вбитые мимо токенов. В светлых темах (`notion`) они не
// видны: подсветка строки `hover:bg-white/5` не показывает наведение, белая
// обводка выбранной метки сливается с белым фоном, белое кольцо выбранного
// цвета ничего не отмечает, а `rgba(255,255,255,0.2)` как граница кружка метки
// исчезает вовсе. Мобильный гейт цвета эти места не ловит: он смотрит только
// `Mobile*.tsx`, `ModalShell` и `BottomNav`.
//
// Правило: состояний (наведение, нажатие, фокус) с белым цветом вне токенов не
// быть не должно — их правка и есть D-5. Плоские `bg-white/…` фоны лежат в
// списке долга ниже: они красят вид компонента, а не только отклик, и правятся
// отдельной работой со снимками. Список имеет право только сохнуть.
const root = process.cwd();
const SRC = join(root, 'src');

const DEFECTS: Array<[RegExp, string]> = [
  [/(?:hover|active|focus|focus-visible|group-hover|peer-hover):(?:bg|border|ring|shadow)-white\/[\d.]+/, 'отклик состояния белым вне токенов'],
  [/(?<![-\w/])border-white(?![/\w])/, 'белая обводка вне токенов'],
  [/ring-white\/\d/, 'белое кольцо выделения'],
  [/rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0?\.2\s*\)/, 'полупрозрачный белый в inline-стиле'],
];

/** Плоский белый фон: долг, живёт до отдельной правки с просмотром владельцем. */
const FLAT_WHITE_DEBT = new Set([
  'src/app/AppShell.tsx',
  'src/features/archive/components/DocumentPreview.tsx',
  'src/features/settings/components/AccountProfileSection.tsx',
  'src/features/writing/components/WritingSetup.tsx',
  'src/shared/components/MeScreenHelpers.tsx',
]);
const FLAT_WHITE = /(?<![:\w-])bg-white\/[\d.]/g;

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

function collect(text: string, where: string): string[] {
  const hits: string[] = [];
  for (const [re, why] of DEFECTS) {
    for (const m of text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))) {
      const line = text.slice(0, m.index).split('\n').length;
      hits.push(`${where}:${line} ${m[0]} — ${why}`);
    }
  }
  return hits;
}

function flatWhiteFiles(): string[] {
  return tsxFiles(SRC)
    .map(f => relative(root, f))
    .filter(rel => readFileSync(join(root, rel), 'utf8').match(FLAT_WHITE) !== null);
}

describe('D-5: белых цветов мимо токенов в компонентах нет', () => {
  it('ни одного дефектного шаблона в src', () => {
    const hits = tsxFiles(SRC).flatMap(f => collect(readFileSync(f, 'utf8'), relative(root, f)));
    expect(hits, `белый вне токенов:\n${hits.join('\n')}`).toEqual([]);
  });

  it('гейт не холостой: каждый посаженный шаблон находится', () => {
    const planted = [
      '<Button className="text-text-main hover:bg-white/5" />',
      '<Button className="border-2 border-white scale-105" />',
      '<Button className="ring-2 ring-white/40" />',
      "style={{ borderColor: 'rgba(255,255,255,0.2)' }}",
    ].join('\n');
    expect(collect(planted, 'planted.tsx')).toHaveLength(DEFECTS.length);
  });

  it('белая спираль на цветной кнопке — не находка', () => {
    expect(collect('<div className="border-2 border-white/20 border-t-white" />', 'ok.tsx')).toEqual([]);
  });

  it('список долга по плоскому белому фону не растёт', () => {
    const found = flatWhiteFiles();
    const grown = found.filter(f => !FLAT_WHITE_DEBT.has(f));
    expect(grown, `новый файл с плоским bg-white/…: ${grown.join(', ')}`).toEqual([]);
  });
});
