// MF-14: под временем в строке и в строке названия карточки — три значка
// состояния: облако, устройство, разбор ИИ. Индикаторы, а не кнопки.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
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

const base = {
  id: 'doc_mf14', userId: 'u1', content: 'Текст.', duration: 60, wordCount: 1, sittings: [], title: 'Круг',
  tags: [], createdAt: new Date(2026, 9, 14, 9, 33), sessionStartTime: new Date(2026, 9, 14, 9, 33).getTime(),
} as unknown as ArchiveSession;

function row(over: Partial<ArchiveSession>, aiProcessed = false, onOpen = vi.fn()) {
  render(<NoteRow session={{ ...base, ...over } as ArchiveSession} aiProcessed={aiProcessed} onOpen={onOpen} t={(k: string) => k} language="ru" userId="user_1" onTagsChange={vi.fn()} onDelete={vi.fn()} />);
  return document.querySelector<HTMLElement>('[data-storage-state]')!;
}
const on = (g: HTMLElement) => Array.from(g.querySelectorAll('svg')).map(s => s.getAttribute('class')?.includes('text-text-main/70'));

describe('MF-14: storage and AI state icons', () => {
  beforeEach(() => { cleanup(); layoutMode = 'mobile'; });

  it('local-only, not analysed → device bright; cloud and ✦ faint', () => {
    expect(on(row({ _isLocal: true, _hasCloudCopy: false }))).toEqual([false, true, false]);
  });

  it('cloud + local + analysed → all bright; the group has one aria label', () => {
    const g = row({ _isLocal: true, _hasCloudCopy: true }, true);
    expect(on(g)).toEqual([true, true, true]);
    expect(g.getAttribute('aria-label')).toBe('archive_state_cloud · archive_state_device · archive_state_analyzed');
  });

  it('a tap on the icons opens the note like any tap on the row', () => {
    const onOpen = vi.fn();
    const g = row({ _isLocal: true }, false, onOpen);
    fireEvent.click(g);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(g.closest('button')).toBeNull();
  });

  it('grid: the icons sit in the title line, the title truncates first', () => {
    render(<GridNoteCard session={{ ...base, _isLocal: true, title: 'Очень длинное название заметки про глину и круг' } as ArchiveSession} onClick={vi.fn()} userId="user_1" searchQuery="" />);
    const g = document.querySelector<HTMLElement>('[data-storage-state]')!;
    const title = screen.getByRole('heading', { level: 2 });
    expect(g.parentElement).toBe(title.parentElement);
    expect(title.className).toContain('truncate');
    expect(title.className).toContain('min-w-0');
    expect(g.className).toContain('shrink-0');
  });
});
