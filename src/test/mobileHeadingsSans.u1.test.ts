// U-1 (унификация 2026-10-18, решение владельца «десктоп — эталон»): заголовки
// телефона — Inter, как на десктопе. Засечки в «Заметках», «Записано.», читалке
// и общей мобильной шапке делали телефон другим приложением.
// Мутация: вернуть font-serif в любой из файлов → красный.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const FILES = [
  'src/features/archive/components/MobileArchiveHeader.tsx',
  'src/features/archive/components/MobileNoteReader.tsx',
  'src/shared/components/MobilePageHeader.tsx',
  'src/features/writing/components/WritingFinishModal.tsx',
];

describe('U-1: заголовки телефона без засечек', () => {
  it.each(FILES)('%s', f => {
    expect(readFileSync(f, 'utf8')).not.toMatch(/\bfont-serif\b/);
  });
});
