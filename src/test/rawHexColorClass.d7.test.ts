import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// D-7: цвет «легендарных» достижений был вбит литералом `text-[#f5c518]` — мимо
// токенов и тем. Произвольный hex в цветовом классе тема не красит, поэтому в
// светлой теме он либо нечитаем, либо спорит с остальными акцентами. Правильный
// путь — `text-accent-warning`; гейт ниже не даёт такому литералу вернуться.
const root = process.cwd();
const SRC = join(root, 'src');
const HEX_CLASS = /(?:text|bg|border|fill|stroke|ring|from|via|to)-\[#/gi;

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
  for (const m of text.matchAll(HEX_CLASS)) {
    const line = text.slice(0, m.index).split('\n').length;
    hits.push(`${where}:${line} ${m[0]}`);
  }
  return hits;
}

describe('D-7: в компонентах нет цветовых классов с произвольным hex', () => {
  const files = tsxFiles(SRC);

  it('ни одного `text-[#…]`, `bg-[#…]` и т. п. в src', () => {
    const hits = files.flatMap(f => collect(readFileSync(f, 'utf8'), relative(root, f)));
    expect(hits, `литералы цвета: ${hits.join(', ')}`).toEqual([]);
  });

  it('гейт не холостой: посаженный литерал находится', () => {
    const planted = `<span className="text-[#f5c518]">легендарные</span>`;
    expect(collect(planted, 'planted.tsx')).toEqual(['planted.tsx:1 text-[#']);
  });

  it('«легендарные» красятся токеном accent-warning', () => {
    const src = readFileSync('src/features/profile/components/Achievements.tsx', 'utf8');
    expect(src).toContain('className="text-accent-warning"');
  });
});
