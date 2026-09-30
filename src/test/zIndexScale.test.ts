import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * G-6 (R3-043): DESIGN.md — «не выдумывай z-index вне шкалы `--z-*`».
 *
 * Слой поверх страницы берёт место из шкалы: `z-[var(--z-overlay)]`. Порядок
 * внутри одного контейнера — шаги Tailwind (`z-10` … `z-50`). Произвольные
 * числа (`z-[100]`, `z-[35]`, `z-[9999]`) не значат ничего ни в одной из двух
 * систем, и следующий слой приходится подбирать перебором.
 *
 * Чего ворота не проверяют: фиксированные слои, стоящие на `z-50` вместо места
 * в шкале, — их 22, и это отдельная работа.
 */
const SRC = resolve(__dirname, '..');
const STEPS = new Set(['0', '10', '20', '30', '40', '50']);

const files = (readdirSync(SRC, { recursive: true }) as string[])
  .filter(f => f.endsWith('.tsx') && !f.includes('__tests__') && !f.includes('.test.'));

describe('z-index stays on the scale', () => {
  it('no arbitrary z-index numbers in TSX', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const lines = readFileSync(join(SRC, f), 'utf8').split('\n');
      lines.forEach((line, i) => {
        for (const m of line.matchAll(/(?<![\w-])-?z-(?:\[(-?\d+)\]|(\d+))(?![\w-])/g)) {
          if (m[1] !== undefined || !STEPS.has(m[2]!)) offenders.push(`${f}:${i + 1} ${m[0]}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('the gate sees what it guards against', () => {
    const hit = (s: string) => /(?<![\w-])-?z-(?:\[(-?\d+)\]|(\d+))(?![\w-])/.exec(s);
    expect(hit('absolute z-[100] flex')?.[1]).toBe('100');
    expect(hit('absolute z-35 flex')?.[2]).toBe('35');
    expect(hit('z-[var(--z-overlay)]')).toBeNull();
    expect(hit('translate-z-10 blur-z-[3]')).toBeNull();
  });
});
