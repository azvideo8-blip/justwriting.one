// MF-24 (SA-14): жёсткие цвета в мобильных компонентах ломают светлую тему
// (белые рамки на светлом фоне не видны). Гейт: слоты темы или `color-ok:`.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findHardcodedColors } from '../check-mobile-colors.mjs';

describe('MF-24: mobile hard-coded colour gate', () => {
  it('the repo has none (outside commented exceptions)', () => {
    expect(findHardcodedColors(process.cwd())).toEqual([]);
  });

  it('catches white/, black/, rgba( and #hex; a color-ok comment exempts the line', () => {
    const root = mkdtempSync(join(tmpdir(), 'mf24-'));
    mkdirSync(join(root, 'src/x'), { recursive: true });
    writeFileSync(join(root, 'src/x/MobileProbe.tsx'), [
      'const a = "bg-white/[0.02]";',
      'const b = "bg-black/60";',
      'const c = "shadow-[0_0_rgba(0,0,0,0.4)]";',
      'const d = "#A583E8";',
      '// color-ok: scrim is the same in every theme',
      'const e = "bg-black/60";',
      'const f = "bg-surface-popup border-border-subtle";',
    ].join('\n'));
    const found = findHardcodedColors(root).map(s => s.split(':')[1]);
    expect(found).toEqual(['1', '2', '3', '4']);
  });
});
