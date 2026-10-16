// MF-24 (SA-14): жёсткие цвета в мобильных компонентах ломают светлую тему
// (белые рамки на светлом фоне не видны). Гейт: слоты темы или `color-ok:`.
// R7Q-032: на Windows `readdirSync(…, {recursive:true})` отдаёт пути с `\`, и
// отбор `Mobile….tsx` через `/` не находит ни одного файла — гейт зелёный,
// ничего не проверив.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findHardcodedColors, isMobileSourceFile, mobileSourceFiles, selectMobileFiles } from '../check-mobile-colors.mjs';
import { toPosixPath } from '../gate-paths.mjs';

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

describe('R7Q-032: пути с обратным слэшём попадают в отбор', () => {
  const winEntry = 'features\\archive\\components\\MobileArchiveScreen.tsx';

  it('без нормализации такой путь мобильным не считается — ровно это и ломалось', () => {
    expect(isMobileSourceFile(join('src', winEntry))).toBe(false);
  });

  it('отбор сам нормализует то, что отдал readdirSync', () => {
    // Вызов именно функции скрипта, а не проверка toPosixPath руками: иначе
    // удаление нормализации из скрипта тест не заметит.
    expect(selectMobileFiles([winEntry, 'features/x/MobileOther.tsx'])).toEqual([
      'src/features/archive/components/MobileArchiveScreen.tsx',
      'src/features/x/MobileOther.tsx',
    ]);
    expect(selectMobileFiles(['features\\x\\__tests__\\MobileProbe.test.tsx'])).toEqual([]);
  });

  it('после нормализации считается; тесты и `__tests__` по-прежнему вне отбора', () => {
    expect(isMobileSourceFile(toPosixPath(join('src', winEntry)))).toBe(true);
    expect(isMobileSourceFile(toPosixPath(join('src', 'features\\x\\__tests__\\MobileProbe.test.tsx')))).toBe(false);
  });

  it('на реальном репозитории отбор находит мобильные файлы, а не пустой список', () => {
    // Без этого проверять «гейт зелёный» нельзя: зелёный пустой список выглядит
    // так же, как зелёный просмотренный.
    const files = mobileSourceFiles(process.cwd()) as string[];
    expect(files.filter((f: string) => /(^|\/)Mobile[^/]*\.tsx$/.test(f)).length, 'мобильных файлов в отборе')
      .toBeGreaterThan(5);
    expect(files).toContain('src/shared/components/ModalShell.tsx');
    expect(files.every((f: string) => !f.includes('\\')), 'ни одного пути с обратным слэшём').toBe(true);
  });
});
