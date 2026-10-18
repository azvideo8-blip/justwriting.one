// U-4 (решение владельца 2026-10-18): у листа один заголовок — общий `SheetTitle`,
// кеглем как заголовок десктопной модалки (18 px). Листы, которые рисовали
// заголовок своей строкой, переведены на него.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { SheetTitle } from '../ModalShell';

describe('U-4: один заголовок листа', () => {
  it('SheetTitle — h2 с id и кеглем 18 px', () => {
    const caption = 'Ещё';
    render(<SheetTitle id="sheet-title-x">{caption}</SheetTitle>);
    const title = screen.getByRole('heading', { level: 2, name: caption });
    expect(title).toHaveAttribute('id', 'sheet-title-x');
    expect(title.className).toContain('text-[18px]');
  });

  it('листы рисуют заголовок через SheetTitle', () => {
    const sheets = [
      'src/features/archive/components/MobileArchiveMenuSheet.tsx',
      'src/features/archive/components/MobileRenameSheet.tsx',
      'src/features/archive/components/ArchiveTrashView.tsx',
      'src/features/archive/components/MobileNoteReader.tsx',
      'src/features/ai/components/chat/MobileDialogueListSheet.tsx',
      'src/features/ai/components/chat/MobilePersonaSheet.tsx',
      'src/features/ai/components/chat/AIChatHeader.tsx',
      'src/features/ai/components/AIChatPresentational.tsx',
      'src/features/writing/components/MobileWriteToolbar.tsx',
      'src/features/writing/components/MobileVoiceNoticeSheet.tsx',
    ];
    for (const path of sheets) {
      expect(readFileSync(path, 'utf8'), path).toContain('<SheetTitle');
    }
  });

  it('лист действий заметки остаётся без видимого заголовка (sr-only)', () => {
    const src = readFileSync('src/app/components/MobileNoteActionsSheet.tsx', 'utf8');
    expect(src).toContain('<h2 id="note-actions-sheet-title" className="sr-only"');
  });
});
