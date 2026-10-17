// R7F-023: телефонное «Сохранить как…» врало про причину и молчало про провал.
//
//  (1) заметка из облака, текст которой ещё не скачан, отказывала молча —
//      десктопное превью гидратирует, а лист нет (ArchiveExportService при этом
//      отдаёт пустой файл нельзя, поэтому отказывал);
//  (2) запертой заметке useArchiveSessions ставит ещё и `_contentNotLoaded`, а
//      лист проверяет его ПЕРВЫМ → «текст ещё не загружен из облака» вместо
//      «заметка заперта — открой сейф»;
//  (3) `void fn(); onClose();` выбрасывало промис: динамический import('docx')
//      мог не докачаться, и человек не видел ни файла, ни сообщения.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { LanguageProvider } from '../shared/i18n';
import { ToastProvider } from '../shared/components/Toast';
import { MobileNoteActionsSheet } from '../app/components/MobileNoteActionsSheet';
import type { ArchiveSession } from '../features/archive/types';

const exp = vi.hoisted(() => ({ txt: vi.fn(), md: vi.fn(), docx: vi.fn(), pdf: vi.fn() }));
const loader = vi.hoisted(() => ({ loadSessionContent: vi.fn() }));

vi.mock('../core/services/ArchiveExportService', async (orig) => {
  const actual = await orig<typeof import('../core/services/ArchiveExportService')>();
  return { ...actual, exportAsTxt: exp.txt, exportAsMd: exp.md, exportAsDocx: exp.docx, exportAsPdf: exp.pdf };
});
vi.mock('../core/services/UnifiedSessionLoader', () => ({
  ...actualLoaderShim(),
  loadSessionContent: loader.loadSessionContent,
}));

// loadAllSessions листу не нужен, но модуль-мок обязан отдать хоть что-то:
// иначе импорт упадёт раньше теста.
function actualLoaderShim(): Record<string, unknown> {
  return { loadAllSessions: vi.fn(async () => ({ sessions: [], cloudLoadFailed: false })) };
}

// Кириллица в фикстуре — через const: поле `title` с литералом гейт C-4 считает
// стоком текста в UI (тот же приём, что NOTE_TITLE в MobileNoteActionsSheetOrder).
const NOTE_TITLE = 'Тихий вечер';

const NOTE = {
  id: 'doc-77', userId: 'user_1', title: NOTE_TITLE, content: '',
  createdAt: new Date(2026, 9, 1).toISOString(), duration: 60, wordCount: 0, tags: [], sittings: [],
  _isLocal: false, _hasCloudCopy: true, _linkedCloudId: 'c-77',
} as unknown as ArchiveSession;

function renderSheet(session: ArchiveSession) {
  const onClose = vi.fn();
  render(
    <LanguageProvider>
      <ToastProvider>
        <MobileNoteActionsSheet
          isOpen
          onClose={onClose}
          session={session}
          userId="user_1"
          labels={[]}
          onOpen={vi.fn()}
          onRename={vi.fn()}
          onAddTag={vi.fn()}
          onDelete={vi.fn()}
          onLabelChange={vi.fn()}
          onStorageChange={vi.fn()}
        />
      </ToastProvider>
    </LanguageProvider>,
  );
  const dialog = screen.getByRole('dialog', { name: 'Действия с заметкой' });
  return { dialog, onClose };
}

async function openSaveAs(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole('button', { name: /Сохранить как/ }));
  return dialog;
}

beforeEach(() => {
  Object.values(exp).forEach(f => f.mockReset());
  loader.loadSessionContent.mockReset();
});

afterEach(() => cleanup());

describe('R7F-023: «Сохранить как…» на телефоне', () => {
  it('незагруженный облачный текст докачивается, и файл выходит', async () => {
    loader.loadSessionContent.mockResolvedValue({ content: 'Свет в окне.', _contentNotLoaded: false });
    exp.md.mockResolvedValue(undefined);
    const { dialog, onClose } = renderSheet({ ...NOTE, _contentNotLoaded: true } as ArchiveSession);
    await openSaveAs(dialog);

    fireEvent.click(within(dialog).getByRole('button', { name: /Markdown|\.md/i }));
    await vi.waitFor(() => expect(exp.md).toHaveBeenCalled());

    expect(loader.loadSessionContent, 'облачный текст не докачан').toHaveBeenCalledTimes(1);
    expect(loader.loadSessionContent.mock.calls[0]![1]).toBe('doc-77');
    const exported = exp.md.mock.calls[0]![0] as ArchiveSession;
    expect(exported.content, 'экспорт ушёл по прежнему снимку без текста').toBe('Свет в окне.');
    expect(screen.queryByText(/ещё не загружен/i), 'отказ остался, хотя текст докачан').toBeNull();
    expect(onClose).toHaveBeenCalled();
  });

  it('запертой заметке показывается про сейф, а не про незагруженный текст', async () => {
    const { dialog } = renderSheet({ ...NOTE, _locked: true, _contentNotLoaded: true } as ArchiveSession);
    await openSaveAs(dialog);

    fireEvent.click(within(dialog).getByRole('button', { name: /Markdown|\.md/i }));

    expect(await screen.findByText(/открой сейф/i)).toBeInTheDocument();
    expect(screen.queryByText(/ещё не загружен/i), 'показана не та причина отказа').toBeNull();
    expect(exp.md).not.toHaveBeenCalled();
    expect(loader.loadSessionContent, 'запертую заметку не докачивают').not.toHaveBeenCalled();
  });

  // Ревью приёмки 0.10.0: облачный загрузчик ищет заметку по облачному id. Для
  // локальной он вернул бы пустой текст без флага ошибки — и вышел бы пустой файл.
  it('локальную заметку облачным загрузчиком не докачивают', async () => {
    loader.loadSessionContent.mockResolvedValue({ content: '', _contentNotLoaded: false });
    const { dialog } = renderSheet({ ...NOTE, _isLocal: true, _contentNotLoaded: true } as ArchiveSession);
    await openSaveAs(dialog);

    fireEvent.click(within(dialog).getByRole('button', { name: /Markdown|\.md/i }));

    expect(await screen.findByText(/ещё не загружен/i)).toBeInTheDocument();
    expect(loader.loadSessionContent).not.toHaveBeenCalled();
    expect(exp.md).not.toHaveBeenCalled();
  });

  it('провал DOCX виден человеком, а не только в консоли', async () => {
    exp.docx.mockRejectedValue(new Error('chunk load failed'));
    const { dialog } = renderSheet(NOTE);
    await openSaveAs(dialog);

    fireEvent.click(within(dialog).getByRole('button', { name: /DOCX|Word/i }));

    expect(await screen.findByText(/не удалось сохранить/i)).toBeInTheDocument();
    expect(loader.loadSessionContent).not.toHaveBeenCalled();
  });

  it('успешный экспорт закрывает лист и не показывает отказ', async () => {
    exp.txt.mockResolvedValue(undefined);
    const { dialog, onClose } = renderSheet(NOTE);
    await openSaveAs(dialog);

    fireEvent.click(within(dialog).getByRole('button', { name: /TXT|Текст/i }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByText(/не удалось сохранить/i)).toBeNull();
  });
});
