// MP-6: строка заметки на телефоне живёт по тому же правилу «сначала текст»,
// что читалка (MP-1) и карточка (MP-2): время · заголовок · одна строка текста ·
// теги приглушённым текстом · «⋯». Плашки «только в облаке» и «слишком велика»
// — это состояние хранилища, на телефоне им не место. Десктопная строка не
// меняется.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NoteRow } from '../NoteRow';
import type { ArchiveSession } from '../../types';

let layoutMode: 'desktop' | 'mobile' = 'mobile';

vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode, setLayoutMode: vi.fn() }),
}));
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

const session = {
  id: 'doc_mp6', userId: 'u1', content: 'Текст заметки про глину и глазурь.', duration: 300, wordCount: 6,
  sessionWordsAdded: 6, sittings: [], charCount: 34, wpm: 12, title: 'Гончарный круг',
  tags: ['глина', 'семья'], createdAt: new Date(2026, 9, 14, 9, 33),
  sessionStartTime: new Date(2026, 9, 14, 9, 33).getTime(),
  _isLocal: false, _hasCloudCopy: true, _linkedCloudId: 'cloud_1', _isTooLargeForSync: true,
  aiProcessed: true,
} as unknown as ArchiveSession;

function renderRow() {
  return render(
    <NoteRow
      session={session}
      onOpen={vi.fn()}
      t={(k: string) => k}
      language="ru"
      userId="user_1"
      onTagsChange={vi.fn()}
      onDelete={vi.fn()}
      onStorageChange={vi.fn()}
    />,
  );
}

describe('MP-6: строка списка на телефоне', () => {
  beforeEach(() => { cleanup(); layoutMode = 'mobile'; });

  it('время · заголовок · одна строка текста · теги текстом · «⋯»', () => {
    renderRow();
    expect(screen.getByText('09:33')).toBeInTheDocument();
    expect(screen.getByText('Гончарный круг')).toBeInTheDocument();
    expect(screen.getByText(/Текст заметки про глину/)).toBeInTheDocument();
    expect(screen.getByText('#глина #семья')).toBeInTheDocument();
    const more = screen.getByRole('button', { name: 'archive_note_actions' });
    expect(more.className).toContain('w-11');
  });

  it('на строке нет ни одного другого контрола: «⋯» — единственная кнопка', () => {
    renderRow();
    expect(screen.getAllByRole('button'), 'в строке остались иконки хранилища или ИИ').toHaveLength(1);
  });

  // Ревью 0.9.40: «только в облаке» — шум, а «слишком велика» — единственный знак,
  // что заметка не уходит в облако, и на телефоне она остаётся.
  // Мутация: снова спрятать «слишком велика» на телефоне → красный.
  it('на телефоне нет «только в облаке», но есть «слишком велика»', () => {
    renderRow();
    expect(screen.queryByText('archive_cloud_only'), 'в строке осталась плашка «только в облаке»').toBeNull();
    expect(screen.getByText('archive_local_only_too_large')).toBeInTheDocument();
  });
});

describe('MP-6: десктопная строка не изменилась', () => {
  beforeEach(() => { cleanup(); layoutMode = 'desktop'; });

  it('плашки состояния и ряд иконок на месте', () => {
    renderRow();
    expect(screen.getByText('archive_cloud_only')).toBeInTheDocument();
    expect(screen.getByText('archive_local_only_too_large')).toBeInTheDocument();
    expect(screen.getAllByRole('button').length).toBeGreaterThan(1);
  });
});
