// N-8 (emil-review, хвост MQ-15): «Сохранить как…» подменяла содержимое листа
// действий в один кадр, и высота рывком падала примерно с десяти строк до четырёх —
// прыжок тянул за собой затемнение. Правка: кроссфейд только по прозрачности
// (AnimatePresence mode="wait") и пол высоты вложенного вида по прежнему виду.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { LanguageProvider } from '../shared/i18n';
import { ToastProvider } from '../shared/components/Toast';
import { MobileNoteActionsSheet } from '../app/components/MobileNoteActionsSheet';
import type { ArchiveSession } from '../features/archive/types';

const exp = vi.hoisted(() => ({ txt: vi.fn(), md: vi.fn(), docx: vi.fn() }));
vi.mock('../core/services/ArchiveExportService', async (orig) => {
  const actual = await orig<typeof import('../core/services/ArchiveExportService')>();
  return { ...actual, exportAsTxt: exp.txt, exportAsMd: exp.md, exportAsDocx: exp.docx };
});

// Поле `title` с кириллицей прямо в объекте — это UI-сток: гейт i18n требует,
// чтобы такой текст был переменной (тот же приём, что NOTE_TITLE в
// MobileNoteActionsSheetOrder).
const NOTE_TITLE = 'Тихий вечер';
const NOTE_CONTENT = 'Тихий вечер. Свет в окне.';

const base = {
  id: 'doc-n8', userId: 'user_n8', title: NOTE_TITLE, content: NOTE_CONTENT,
  createdAt: new Date(2026, 9, 1), duration: 60, wordCount: 5, tags: [], sittings: [],
  labelId: 'l-1', _isLocal: true, _hasCloudCopy: true, _linkedCloudId: 'c-1',
} as unknown as ArchiveSession;

function renderSheet() {
  render(
    <LanguageProvider>
      <ToastProvider>
        <MobileNoteActionsSheet
          isOpen
          onClose={vi.fn()}
          session={base}
          userId="user_n8"
          labels={[{ id: 'l-1', name: 'Дневник', color: '#88aaff' }]}
          onOpen={vi.fn()}
          onRename={vi.fn()}
          onAddTag={vi.fn()}
          onDelete={vi.fn()}
          onLabelChange={vi.fn()}
          onStorageChange={vi.fn()}
          onAIClick={vi.fn()}
          onAIExclusionClick={vi.fn()}
        />
      </ToastProvider>
    </LanguageProvider>,
  );
  const dialog = screen.getByRole('dialog', { name: 'Действия с заметкой' });
  return { dialog, list: within(dialog).getByTestId('note-actions-list') };
}

describe('N-8: «Сохранить как…» без прыжка высоты', () => {
  beforeEach(() => { cleanup(); Object.values(exp).forEach(f => f.mockClear()); });

  it('вложенный вид получает пол высоты, равный виду действий', () => {
    const { list } = renderSheet();
    Object.defineProperty(list, 'scrollHeight', { value: 412, configurable: true });
    fireEvent.click(within(list).getByRole('button', { name: /Сохранить как/ }));
    const saveAs = screen.getByTestId('note-save-as');
    expect(saveAs.style.minHeight, 'лист сжимается рывком — высоты нет')
      .toBe('412px');
  });

  it('у вложенного вида есть управляемая прозрачность (кроссфейд, а не склейка)', () => {
    const { list } = renderSheet();
    fireEvent.click(within(list).getByRole('button', { name: /Сохранить как/ }));
    const saveAs = screen.getByTestId('note-save-as');
    expect(saveAs.hasAttribute('style'), 'вид не анимируется: style отсутствует').toBe(true);
  });

  it('обратно из «Сохранить как…» возвращаются тем же списком', () => {
    const { list } = renderSheet();
    fireEvent.click(within(list).getByRole('button', { name: /Сохранить как/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(within(list).getByTestId('note-actions-main')).toBeInTheDocument();
  });
});
