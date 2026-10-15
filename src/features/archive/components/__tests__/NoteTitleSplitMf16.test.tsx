// MF-16: у заметки без названия строка списка показывала первую фразу дважды —
// названием и началом превью. Превью теперь начинается после выведенного
// названия; заметка из одной фразы превью не даёт. То же в карточке сетки.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { splitNoteTitle } from '../noteTitle';
import { NoteRow } from '../NoteRow';
import { GridNoteCard } from '../GridNoteCard';
import type { ArchiveSession } from '../../types';

vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode: 'mobile', setLayoutMode: vi.fn() }),
}));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../../app/useAuthStatus', () => ({ useAuthStatus: () => ({ profile: null, user: null }) }));

const mk = (content: string, title = '') => ({
  id: 'doc_mf16', userId: 'u1', content, title, duration: 60, wordCount: 4, sittings: [], tags: [],
  createdAt: new Date(2026, 9, 14, 9, 33), sessionStartTime: new Date(2026, 9, 14, 9, 33).getTime(), _isLocal: true,
} as unknown as ArchiveSession);

describe('MF-16: no repeated first line', () => {
  beforeEach(() => cleanup());

  it('untitled «Раз два. Три четыре.» → title «Раз два.», preview «Три четыре.»', () => {
    expect(splitNoteTitle('', 'Раз два. Три четыре.')).toEqual({ title: 'Раз два.', preview: 'Три четыре.' });
    expect(splitNoteTitle('  ', 'Только одна фраза.')).toEqual({ title: 'Только одна фраза.', preview: '' });
    expect(splitNoteTitle('Своё', 'Раз два. Три.')).toEqual({ title: 'Своё', preview: 'Раз два. Три.' });
  });

  it('the mobile row renders the title once and the rest as preview', () => {
    render(<NoteRow session={mk('Раз два. Три четыре.')} onOpen={vi.fn()} t={(k: string) => k} language="ru" userId="user_1" onTagsChange={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Раз два.')).toBeInTheDocument();
    expect(screen.getByText('Три четыре.')).toBeInTheDocument();
    expect(screen.queryByText(/Раз два\. Три четыре\./)).toBeNull();
  });

  it('a one-sentence note shows no preview line in the grid card', () => {
    const { container } = render(<GridNoteCard session={mk('Только одна фраза.')} onClick={vi.fn()} userId="user_1" searchQuery="" />);
    expect(screen.getByRole('heading', { level: 4 }).textContent).toBe('Только одна фраза.');
    expect(container.querySelectorAll('p').length).toBe(0);
  });
});
