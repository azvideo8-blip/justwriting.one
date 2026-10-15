// MF-13: цвет метки в строке и в карточке сетки не был виден (подкраска 4 %).
// Теперь в строке мета — точка цвета метки и её имя, перед тегами.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NoteRow } from '../NoteRow';
import { GridNoteCard } from '../GridNoteCard';
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
  id: 'doc_1', userId: 'u1', content: 'Текст заметки про глину.', duration: 300, wordCount: 4,
  sessionWordsAdded: 4, sittings: [], charCount: 24, wpm: 8, title: 'Гончарный круг',
  tags: ['глина', 'семья'], createdAt: new Date(2025, 8, 1, 9, 33),
  sessionStartTime: new Date(2025, 8, 1, 9, 33).getTime(), _isLocal: true,
} as unknown as ArchiveSession;

const LABEL = { id: 'l1', name: 'Аскеза6', color: '#3B6BB5' };

describe('MF-13: label dot and name on the phone', () => {
  beforeEach(() => { cleanup(); layoutMode = 'mobile'; });

  it('a row with a label renders a dot in the label colour plus the name, before the tags', () => {
    render(<NoteRow session={{ ...session, labelId: 'l1' } as ArchiveSession} labels={[LABEL]} onOpen={vi.fn()} t={(k: string) => k} language="ru" userId="user_1" onTagsChange={vi.fn()} onDelete={vi.fn()} />);
    const mark = document.querySelector('[data-label-mark]')!;
    expect(mark, 'нет метки в строке').not.toBeNull();
    const dot = mark.querySelector<HTMLElement>('[aria-hidden="true"]')!;
    expect(dot.style.backgroundColor).toBe('rgb(59, 107, 181)');
    expect(screen.getByText('Аскеза6')).toBeInTheDocument();
    expect(mark.compareDocumentPosition(screen.getByText('#глина #семья')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('no label → neither dot nor name', () => {
    render(<NoteRow session={session} labels={[LABEL]} onOpen={vi.fn()} t={(k: string) => k} language="ru" userId="user_1" onTagsChange={vi.fn()} onDelete={vi.fn()} />);
    expect(document.querySelector('[data-label-mark]')).toBeNull();
    expect(screen.queryByText('Аскеза6')).toBeNull();
  });

  it('a grid card shows the same dot and name', () => {
    render(<GridNoteCard session={{ ...session, labelId: 'l1' } as ArchiveSession} labels={[LABEL]} onClick={vi.fn()} userId="user_1" searchQuery="" />);
    expect(document.querySelector('[data-label-mark]')).not.toBeNull();
    expect(screen.getByText('Аскеза6')).toBeInTheDocument();
  });
});
