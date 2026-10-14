// MB-11 (F-24): на телефоне одиночный тап по заголовку открывает заметку.
// MR-9 перенёс открытие на весь ряд, а долгое нажатие — в лист действий.
// Десктоп не тронут: там клик по заголовку гасится намеренно, открывает двойной клик.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { getSessionKey } from '../../../../core/crypto/encrypt';
import { NoteRow } from '../NoteRow';
import type { ArchiveSession } from '../../types';

let layoutMode: 'desktop' | 'mobile' = 'desktop';

vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode, setLayoutMode: vi.fn() }),
}));
vi.mock('../../../../core/crypto/encrypt', async (importActual) => {
  const actual = await importActual<typeof import('../../../../core/crypto/encrypt')>();
  return { ...actual, getSessionKey: vi.fn() };
});
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../../app/useAuthStatus', () => ({ useAuthStatus: () => ({ profile: null, user: null }) }));
vi.mock('../../../../core/services/StorageService', () => ({
  StorageService: { addLocalCopy: vi.fn(), addCloudCopy: vi.fn(), removeLocalCopy: vi.fn(), removeCloudCopy: vi.fn(), trashDocument: vi.fn() },
}));
vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: { unlinkFromCloud: vi.fn(), clearLocalOnlyForUpload: vi.fn() },
}));

const session: ArchiveSession = {
  id: 'doc_1', userId: 'u1', content: 'Текст заметки.', duration: 300, wordCount: 2,
  sessionWordsAdded: 2, sittings: [], charCount: 14, wpm: 8, title: 'Яблоки и глазурь',
  tags: [], createdAt: new Date(2025, 8, 1, 9, 5), sessionStartTime: new Date(2025, 8, 1, 9, 5).getTime(),
  _isLocal: true,
} as ArchiveSession;

const renderRow = (onOpen = vi.fn()) => {
  render(<NoteRow session={session} onOpen={onOpen} t={(k: string) => k} language="ru" userId="user_1" onTagsChange={vi.fn()} onDelete={vi.fn()} />);
  return onOpen;
};

function titleEl(): HTMLElement {
  return screen.getByText('Яблоки и глазурь');
}

describe('MB-11: один тап открывает заметку', () => {
  beforeEach(() => { cleanup(); layoutMode = 'mobile'; vi.mocked(getSessionKey).mockReturnValue({ key: 'k' } as never); });

  it('мобильный макет: одиночный клик по заголовку открывает заметку', () => {
    const onOpen = renderRow();
    fireEvent.click(titleEl());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('десктоп: клик по заголовку по-прежнему гасится, двойной клик — переименование', () => {
    layoutMode = 'desktop';
    const onOpen = renderRow();
    fireEvent.click(titleEl());
    expect(onOpen, 'на десктопе клик по заголовку открыл заметку — поведение изменилось').not.toHaveBeenCalled();

    fireEvent.doubleClick(titleEl());
    expect(screen.getByDisplayValue('Яблоки и глазурь'), 'двойной клик не открыл поле переименования').toBeTruthy();
  });

  it('долгое нажатие на телефоне открывает лист действий, и тот же палец не открывает заметку', () => {
    // MR-9 перенёс долгое нажатие с инлайн-переименования на лист действий:
    // «Переименовать» живёт там же, где и остальное.
    vi.useFakeTimers();
    const onOpen = renderRow();
    const el = titleEl();
    act(() => { fireEvent.touchStart(el, { touches: [{ clientX: 5, clientY: 5 }] }); });
    act(() => { vi.advanceTimersByTime(600); });
    vi.useRealTimers();

    expect(screen.getByRole('dialog'), 'долгое нажатие не открыло лист действий').toBeTruthy();
    expect(screen.queryByDisplayValue('Яблоки и глазурь'), 'долгое нажатие открыло инлайн-переименование').toBeNull();
    fireEvent.click(el);
    expect(onOpen, 'после долгого нажатия тот же палец открыл ещё и заметку').not.toHaveBeenCalled();
  });

  // Ревью 0.9.39: телефоны без мобильного макета (почти все) получают десктоп,
  // и долгое нажатие на заголовок там открывало переименование. MR-9 повесил
  // касания только на мобильный ряд — эта возможность пропала.
  // Мутация: убрать onTouchStart с заголовка в десктопном макете → красный.
  it('десктопный макет на сенсорном экране: долгое нажатие на заголовок — переименование', () => {
    layoutMode = 'desktop';
    vi.useFakeTimers();
    renderRow();
    act(() => { fireEvent.touchStart(titleEl(), { touches: [{ clientX: 5, clientY: 5 }] }); });
    act(() => { vi.advanceTimersByTime(700); });
    vi.useRealTimers();
    expect(screen.getByDisplayValue('Яблоки и глазурь'), 'долгое нажатие не открыло переименование').toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // Ревью 0.9.39: лист действий — портал, и касания из него всплывают по дереву
  // React до ряда. Палец, задержанный в листе, заводил долгое нажатие ряда, и
  // следующий тап по ряду проглатывался.
  // Мутация: убрать onTouchStart-гашение вокруг листа → красный.
  it('палец, задержанный в листе действий, не съедает следующий тап по ряду', () => {
    layoutMode = 'mobile';
    const onOpen = renderRow();
    fireEvent.click(screen.getByRole('button', { name: 'archive_note_actions' }));
    vi.useFakeTimers();
    act(() => { fireEvent.touchStart(screen.getByRole('dialog'), { touches: [{ clientX: 5, clientY: 5 }] }); });
    act(() => { vi.advanceTimersByTime(700); });
    act(() => { fireEvent.touchEnd(screen.getByRole('dialog')); });
    vi.useRealTimers();
    // Лист ещё открыт и сам показывает заголовок; заголовок ряда — первый в DOM.
    fireEvent.click(screen.getAllByText('Яблоки и глазурь')[0]!);
    expect(onOpen, 'тап по ряду после касания в листе не открыл заметку').toHaveBeenCalledTimes(1);
  });
});
