// Карточка архива показывает то же, что строка (владелец, 2026-09-30): полосу
// метки, цветные копии и разбор, меню «⋯».
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { getSessionKey } from '../../../../core/crypto/encrypt';
import { GridNoteCard } from '../GridNoteCard';
import { ArchiveSession } from '../../types';
import { Label } from '../../../../types';

vi.mock('../../../../core/crypto/encrypt', async (importActual) => {
  const actual = await importActual<typeof import('../../../../core/crypto/encrypt')>();
  return { ...actual, getSessionKey: vi.fn() };
});

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));

vi.mock('../../../../shared/components/ConfirmDialog', () => ({
  useConfirmDialog: () => ({ prompt: vi.fn(), confirm: vi.fn(), alert: vi.fn() }),
}));

vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ profile: null, user: null }),
}));

vi.mock('../../../../core/services/StorageService', () => ({
  StorageService: {
    addLocalCopy: vi.fn(),
    addCloudCopy: vi.fn(),
    removeLocalCopy: vi.fn(),
    removeCloudCopy: vi.fn(),
    trashDocument: vi.fn(),
  },
}));

vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: { unlinkFromCloud: vi.fn(), clearLocalOnlyForUpload: vi.fn() },
}));


const labels: Label[] = [{ id: 'lbl_1', name: 'Работа', color: '#e0a458' }];

function sessionOf(extra: Partial<ArchiveSession> = {}): ArchiveSession {
  return {
    id: 'doc_1',
    userId: 'u1',
    content: 'Текст заметки для теста строки архива.',
    duration: 300,
    wordCount: 42,
    sessionWordsAdded: 42,
    sittings: [],
    charCount: 30,
    wpm: 8,
    title: 'Первая строка заголовка',
    tags: [],
    createdAt: new Date(2025, 8, 1, 9, 5),
    sessionStartTime: new Date(2025, 8, 1, 9, 5).getTime(),
    _isLocal: true,
    ...extra,
  };
}

function renderCard(session: ArchiveSession, extra: Record<string, unknown> = {}) {
  const onClick = vi.fn();
  const r = render(
    <GridNoteCard session={session} onClick={onClick} userId="user_1" labels={labels} {...extra} />,
  );
  return { ...r, onClick };
}

describe('карточка архива', () => {
  beforeEach(() => {
    cleanup();
    vi.mocked(getSessionKey).mockReturnValue({ key: 'k' } as never);
  });

  it('метка — полоса слева, как у строки', () => {
    const { container } = renderCard(sessionOf({ labelId: 'lbl_1' }));
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain('border-l-2');
    expect(card.style.borderLeftColor).not.toBe('');
  });

  it('разобранная заметка — искра горит, копия в облаке — облако горит', () => {
    renderCard(sessionOf({ _hasCloudCopy: true, _linkedCloudId: 'cloud_1' }), { aiProcessed: true, onAIClick: vi.fn() });
    expect(screen.getByRole('button', { name: 'archive_status_ai_done · ai_note_clear' }).classList.contains('text-brand-soft')).toBe(true);
    expect(screen.getByRole('button', { name: 'archive_status_cloud · storage_remove_cloud' }).classList.contains('text-brand-soft')).toBe(true);
  });

  it('«⋯» открывает меню, пункт меню не открывает заметку', () => {
    const onDelete = vi.fn();
    const { onClick } = renderCard(sessionOf(), { onDelete });
    fireEvent.click(screen.getByRole('button', { name: 'archive_note_actions' }));
    const menu = screen.getByRole('menu', { name: 'archive_note_actions' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'archive_delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });
});
