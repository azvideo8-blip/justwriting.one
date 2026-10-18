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

  // U-34 (решение владельца 2026-10-18 по Q-5): на телефоне цвет метки несёт та же
  // полоса, что на десктопе, — `border-l-2`, подкраска 4 % и внутреннее свечение.
  it('полоса метки на телефоне — как на десктопе', () => {
    const { container } = render(<NoteRow session={{ ...session, labelId: 'l1' } as ArchiveSession} labels={[LABEL]} onOpen={vi.fn()} t={(k: string) => k} language="ru" userId="user_1" onTagsChange={vi.fn()} onDelete={vi.fn()} />);
    const row = container.querySelector('div.grid') as HTMLElement;
    expect(row.className).toContain('border-l-2');
    expect(row.style.borderLeftColor).not.toBe('');
    expect(row.style.background).toContain('4%');
    expect(row.style.boxShadow).not.toBe('');
  });

  it('без метки на телефоне полоса прозрачна', () => {
    const { container } = render(<NoteRow session={session} labels={[LABEL]} onOpen={vi.fn()} t={(k: string) => k} language="ru" userId="user_1" onTagsChange={vi.fn()} onDelete={vi.fn()} />);
    const row = container.querySelector('div.grid') as HTMLElement;
    expect(row.className).toContain('border-l-transparent');
    expect(row.style.boxShadow).toBe('');
  });

  it('a grid card shows the same dot and name', () => {
    render(<GridNoteCard session={{ ...session, labelId: 'l1' } as ArchiveSession} labels={[LABEL]} onClick={vi.fn()} userId="user_1" searchQuery="" />);
    expect(document.querySelector('[data-label-mark]')).not.toBeNull();
    expect(screen.getByText('Аскеза6')).toBeInTheDocument();
  });

  // U-34 (хвост, решение владельца 2026-10-18): карточка сетки на телефоне — та же
  // полоса метки, что у строки и у десктопной карточки; тонировка 10 % без полосы была.
  it('карточка сетки на телефоне — полоса метки как у строки', () => {
    const { container } = render(<GridNoteCard session={{ ...session, labelId: 'l1' } as ArchiveSession} labels={[LABEL]} onClick={vi.fn()} userId="user_1" searchQuery="" />);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className, 'у карточки нет полосы метки').toContain('border-l-2');
    expect(card.style.borderLeftColor).not.toBe('');
    expect(card.style.background, 'подкраска карточки не 4 %').toContain('4%');
    expect(card.style.boxShadow, 'у карточки нет внутреннего свечения').not.toBe('');
  });

  it('карточка сетки без метки — полоса прозрачна, свечения нет', () => {
    const { container } = render(<GridNoteCard session={session} labels={[LABEL]} onClick={vi.fn()} userId="user_1" searchQuery="" />);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('border-l-transparent');
    expect(card.style.boxShadow).toBe('');
  });
});
