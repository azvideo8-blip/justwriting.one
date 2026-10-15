// G-6 (R3-032, R3-034, R3-035): лист действий на телефоне, aria у «⋯», контраст.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, waitFor } from '@testing-library/react';
import { getSessionKey } from '../../../../core/crypto/encrypt';
import { NoteRow } from '../NoteRow';
import { ArchiveSession } from '../../types';

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

const t = (k: string) => k;

const session: ArchiveSession = {
  id: 'doc_1',
  userId: 'u1',
  content: 'Текст заметки.',
  duration: 300,
  wordCount: 2,
  sessionWordsAdded: 2,
  sittings: [],
  charCount: 14,
  wpm: 8,
  title: 'Заголовок',
  tags: ['дом'],
  createdAt: new Date(2025, 8, 1, 9, 5),
  sessionStartTime: new Date(2025, 8, 1, 9, 5).getTime(),
  _isLocal: true,
};

const renderRow = () =>
  render(<NoteRow session={session} onOpen={vi.fn()} t={t} language="ru" userId="user_1" onTagsChange={vi.fn()} onDelete={vi.fn()} />);

describe('G-6: строка архива', () => {
  beforeEach(() => {
    cleanup();
    layoutMode = 'desktop';
    vi.mocked(getSessionKey).mockReturnValue({ key: 'k' } as never);
  });

  // R3-034: у триггера не было ни aria-haspopup, ни aria-expanded.
  it('«⋯» объявляет, что открывает меню, и открыто ли оно', () => {
    renderRow();
    const trigger = screen.getByRole('button', { name: 'archive_note_actions' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(screen.getAllByRole('menuitem')[0]!, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  // R3-035: text-text-main/40 × opacity-60 ≈ 24% — ниже порога 3:1.
  // DESIGN.md: 60% в покое, 100% на hover и фокус строки — один уровень.
  it('«⋯» приглушена один раз, а не дважды', () => {
    renderRow();
    const cls = screen.getByRole('button', { name: 'archive_note_actions' }).className;
    expect(cls).toContain('text-text-main/60');
    expect(cls).toContain('group-hover:text-text-main');
    expect(cls).toContain('group-focus-within:text-text-main');
    expect(cls).not.toMatch(/(^|\s)opacity-\d/);
    expect(cls).not.toContain('text-text-main/40');
  });

  // R3-035: «+» был 20×20 и виден только по hover — на тач-экране невидим, но
  // объявляется и ловит фокус.
  it('«+» тега: цель нажатия 44px и виден всегда, без наведения', () => {
    renderRow();
    const cls = screen.getByRole('button', { name: 'archive_add_tag_aria' }).className;
    expect(cls).toContain('clickable-target-expansion');
    expect(cls).not.toContain('opacity-0');
  });

  // R3-032: список строит общая функция, но «Добавить тег» передавал только
  // десктоп. Лист здесь настоящий — заглушка `() => null` это и прятала.
  it('лист действий на телефоне: «Добавить тег» есть и открывает поле в строке', async () => {
    layoutMode = 'mobile';
    renderRow();

    fireEvent.click(screen.getByRole('button', { name: 'archive_note_actions' }));
    const sheet = screen.getByRole('dialog');
    const ids = within(sheet).getAllByRole('button').map(b => b.textContent);
    // MF-12: Открыть · теги · копии · Удалить; переименование — карандаш в шапке.
    expect(ids.filter(x => ['archive_preview', 'archive_rename_title', 'archive_add_tag_aria', 'archive_delete'].includes(x ?? '')))
      .toEqual(['archive_preview', 'archive_add_tag_aria', 'archive_delete']);
    expect(within(sheet).getByRole('button', { name: 'archive_rename_title' })).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('button', { name: 'archive_add_tag_aria' }));

    // MQ-5: лист уходит ~250 мс, а не пропадает за кадр.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByPlaceholderText('archive_tag_placeholder_short')).toBeInTheDocument();
  });
});
