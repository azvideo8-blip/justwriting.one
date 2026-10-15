import { describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { LanguageProvider } from '../shared/i18n';
import { ToastProvider } from '../shared/components/Toast';
import { MobileNoteActionsSheet } from '../app/components/MobileNoteActionsSheet';
import type { ArchiveSession } from '../features/archive/types';

// MC-9: «Удалить заметку» — последний пункт и отделён отступом.
// MF-12: читалка открывает тот же полный лист, что список (без фильтра fromReader);
// порядок «Открыть/Продолжить писать → Добавить тег → метки → облако/устройство →
// ИИ → Сохранить как… → Удалить»; название в шапке — как в списке, с карандашом;
// «Скопировать как» заменён на «Сохранить как…».

const exp = vi.hoisted(() => ({ txt: vi.fn(), md: vi.fn(), docx: vi.fn(), pdf: vi.fn() }));
vi.mock('../core/services/ArchiveExportService', async (orig) => {
  const actual = await orig<typeof import('../core/services/ArchiveExportService')>();
  return { ...actual, exportAsTxt: exp.txt, exportAsMd: exp.md, exportAsDocx: exp.docx, exportAsPdf: exp.pdf };
});

const NOTE_TITLE = 'Тихий вечер';

const base = {
  id: 'doc-1', userId: 'user_1', title: NOTE_TITLE, content: 'Тихий вечер. Свет в окне.',
  createdAt: new Date(2026, 9, 1), duration: 60, wordCount: 5, tags: [], sittings: [],
  labelId: 'l-1', _isLocal: true, _hasCloudCopy: true, _linkedCloudId: 'c-1',
} as unknown as ArchiveSession;

function renderSheet(over: { openLabel?: string; session?: ArchiveSession; onRename?: () => void } = {}) {
  render(
    <LanguageProvider>
      <ToastProvider>
        <MobileNoteActionsSheet
          isOpen
          onClose={vi.fn()}
          session={over.session ?? base}
          userId='user_1'
          labels={[{ id: 'l-1', name: 'Дневник', color: '#88aaff' }]}
          onOpen={vi.fn()}
          openLabel={over.openLabel}
          onRename={over.onRename ?? vi.fn()}
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

const ids = (list: HTMLElement) => Array.from(list.querySelectorAll('[data-action]')).map(el => el.getAttribute('data-action'));

describe('MF-12 / MC-9: one note-actions sheet', () => {
  beforeEach(() => { cleanup(); Object.values(exp).forEach(f => f.mockClear()); });

  it('reader and list sheets list the same action ids; only the first label differs', () => {
    const list = renderSheet().list;
    const listIds = ids(list);
    const listFirst = list.querySelector('[data-action]')!.textContent;
    cleanup();
    const reader = renderSheet({ openLabel: 'Продолжить писать' }).list;
    expect(ids(reader)).toEqual(listIds);
    expect(listIds).toEqual(['open', 'addTag', 'removeLocal', 'removeCloud', 'excludeAi', 'analyzeAi', 'saveAs', 'delete']);
    expect(listFirst).toContain('Открыть');
    expect(reader.querySelector('[data-action]')!.textContent).toContain('Продолжить писать');
  });

  it('labels sit right after «Добавить тег»; delete is last after a gap; no rename/copy rows', () => {
    const { dialog, list } = renderSheet();
    const addTag = list.querySelector('[data-action="addTag"]')!;
    expect(addTag.nextElementSibling?.getAttribute('data-testid')).toBe('note-actions-labels');
    const danger = within(dialog).getByTestId('note-actions-danger');
    expect(danger.className.split(' ').some(c => c.startsWith('mt-')), 'нет отступа перед удалением').toBe(true);
    expect(list.lastElementChild).toBe(danger);
    expect(within(list).queryByRole('button', { name: /Изменить название/ })).toBeNull();
    expect(within(list).queryByRole('button', { name: /Скопировать как/ })).toBeNull();
  });

  it('the header shows the derived title for an untitled note; the pencil opens rename', () => {
    const onRename = vi.fn();
    const { dialog } = renderSheet({ session: { ...base, title: '' } as ArchiveSession, onRename });
    // MF-16: выведенное название — первое предложение, как в списке.
    expect(within(dialog).getByText('Тихий вечер.')).toBeInTheDocument();
    expect(within(dialog).queryByText('Без названия')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Изменить название' }));
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it('«Сохранить как…» lists txt, md, docx (no PDF on the phone); each calls its exporter', () => {
    const { list } = renderSheet();
    fireEvent.click(within(list).getByRole('button', { name: /Сохранить как/ }));
    const formats = Array.from(list.querySelectorAll('[data-format]')).map(el => el.getAttribute('data-format'));
    expect(formats).toEqual(['txt', 'md', 'docx']);
    fireEvent.click(list.querySelector('[data-format="txt"]')!);
    expect(exp.txt).toHaveBeenCalledTimes(1);
  });

  it('a locked note shows the guard message instead of exporting', async () => {
    const { list } = renderSheet({ session: { ...base, _locked: true } as ArchiveSession });
    fireEvent.click(within(list).getByRole('button', { name: /Сохранить как/ }));
    fireEvent.click(list.querySelector('[data-format="md"]')!);
    expect(exp.md).not.toHaveBeenCalled();
    expect(await screen.findByText(/сейф|Сейф|заблок/i)).toBeInTheDocument();
  });
});
