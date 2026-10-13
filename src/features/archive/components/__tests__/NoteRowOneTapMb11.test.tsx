// MB-11 (F-24): на телефоне одиночный тап по заголовку открывает заметку,
// долгое нажатие остаётся переименованием. Десктоп не тронут: там клик по
// заголовку гасится намеренно, открывает двойной клик.
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

  it('долгое нажатие на телефоне — переименование, и оно не открывает заметку', () => {
    vi.useFakeTimers();
    const onOpen = renderRow();
    const el = titleEl();
    act(() => { fireEvent.touchStart(el, { touches: [{ clientX: 5, clientY: 5 }] }); });
    act(() => { vi.advanceTimersByTime(700); });
    vi.useRealTimers();

    expect(screen.getByDisplayValue('Яблоки и глазурь'), 'долгое нажатие не открыло переименование').toBeTruthy();
    fireEvent.click(el);
    expect(onOpen, 'после долгого нажатия тот же палец открыл ещё и заметку').not.toHaveBeenCalled();
  });
});
