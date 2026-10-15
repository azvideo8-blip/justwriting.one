// SA-22: на телефоне скорость красилась оценкой (красный < 15, жёлтый, зелёный, синий),
// вопреки DESIGN.md: «оценки словом и цветом нет — решение владельца 2026-09-30».
// 0.9.41 (MF-3) убрал wpm из строки панели и `wpmColors.ts`; здесь — чтобы не вернулось,
// и чтобы /docs не описывал цвета, которых нет.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();

describe('SA-22: speed has one colour', () => {
  it('the traffic-light helper is gone and nothing imports it', () => {
    expect(existsSync(resolve(root, 'src/features/writing/utils/wpmColors.ts'))).toBe(false);
    for (const f of [
      'src/features/writing/components/MobileWriteToolbar.tsx',
      'src/features/writing/components/MobileWriteScreen.tsx',
      'src/features/writing/components/BottomStats.tsx',
    ]) {
      expect(readFileSync(resolve(root, f), 'utf8'), f).not.toMatch(/wpmColors|getWpmHex/);
    }
  });

  it('the phone panel row carries no speed at all', () => {
    expect(readFileSync(resolve(root, 'src/features/writing/components/MobileWriteToolbar.tsx'), 'utf8')).not.toMatch(/wpm/i);
  });

  it('the guide does not describe a colour scale', () => {
    const html = readFileSync(resolve(root, 'public/docs/writing.html'), 'utf8');
    expect(html).not.toContain('Цвет точки');
    expect(html).not.toContain('меньше 15 слов в минуту');
    expect(html).toContain('точка одного цвета');
  });
});
