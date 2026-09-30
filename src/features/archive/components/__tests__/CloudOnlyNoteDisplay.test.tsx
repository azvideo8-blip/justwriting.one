import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NoteRow } from '../NoteRow';
import { ArchiveTrashView } from '../ArchiveTrashView';
import type { ArchiveSession } from '../../types';

vi.mock('../StorageStatus', () => ({
  StorageStatus: () => <div data-testid="storage-icons" />,
}));

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, language: 'ru' }),
}));

vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ profile: null, user: null }),
}));

const translations: Record<string, string> = {
  archive_cloud_only: 'только в облаке',
  archive_cloud_only_note: 'Заметка из облака',
  session_untitled: 'Без названия',
  archive_stat_words: 'слов',
  archive_edit_date: 'Изменить дату',
};

const t = (k: string) => translations[k] || k;

describe('Cloud-only note display (R-5)', () => {
  const cloudOnlySession: ArchiveSession = {
    id: 'cloud-doc-123',
    userId: 'u1',
    content: '',
    duration: 60,
    wordCount: 150,
    sessionWordsAdded: 150,
    sittings: [],
    charCount: 0,
    wpm: 0,
    title: '',
    tags: [],
    createdAt: new Date('2026-09-01T12:00:00Z'),
    sessionStartTime: 1788264000000,
    _isLocal: false,
    _hasCloudCopy: true,
    _linkedCloudId: 'cloud-doc-123',
    _contentNotLoaded: true,
  };

  it('renders "только в облаке" badge and fallback title in NoteRow', () => {
    render(
      <NoteRow
        session={cloudOnlySession}
        onOpen={vi.fn()}
        t={t}
        language="ru"
        userId="u1"
      />
    );

    // Shows fallback title "Заметка из облака" instead of "Без названия"
    expect(screen.getByText('Заметка из облака')).toBeTruthy();
    // Shows "только в облаке" badge
    const badges = screen.getAllByText('только в облаке');
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it('renders real title if present even for cloud-only notes in NoteRow', () => {
    const titledSession: ArchiveSession = {
      ...cloudOnlySession,
      title: 'Synthesized Title',
    };

    render(
      <NoteRow
        session={titledSession}
        onOpen={vi.fn()}
        t={t}
        language="ru"
        userId="u1"
      />
    );

    expect(screen.getByText('Synthesized Title')).toBeTruthy();
    const badges = screen.getAllByText('только в облаке');
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it('renders "только в облаке" and fallback title in ArchiveTrashView', () => {
    render(
      <ArchiveTrashView
        trashedSessions={[{ ...cloudOnlySession, trashedAt: Date.now() - 3600000 }]}
        onRestore={vi.fn()}
        onDeletePermanently={vi.fn()}
        onEmptyTrash={vi.fn()}
        t={t}
      />
    );

    expect(screen.getByText('Заметка из облака')).toBeTruthy();
    expect(screen.getByText('только в облаке')).toBeTruthy();
  });
});
