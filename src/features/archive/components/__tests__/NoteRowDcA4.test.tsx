import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { getSessionKey } from '../../../../core/crypto/encrypt';
import { NoteRow } from '../NoteRow';
import { ArchiveSession } from '../../types';

vi.mock('../../../../core/crypto/encrypt', async (importActual) => {
  const actual = await importActual<typeof import('../../../../core/crypto/encrypt')>();
  return { ...actual, getSessionKey: vi.fn() };
});

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));

vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ profile: null, user: null }),
}));

const t = (k: string) => k;

const session: ArchiveSession = {
  id: 'doc_1',
  userId: 'u1',
  content: 'Body text for the row.',
  duration: 300,
  wordCount: 20,
  sessionWordsAdded: 20,
  sittings: [],
  charCount: 12,
  wpm: 6,
  title: 'Row title',
  tags: [],
  createdAt: new Date(2025, 8, 1, 9, 5),
  sessionStartTime: new Date(2025, 8, 1, 9, 5).getTime(),
  _isLocal: true,
};

describe('DC-A4 строка: тег добавляется из меню «⋯»', () => {
  it('без тегов в строке нет плашки, «Добавить тег» из меню открывает поле с фокусом, Enter пишет тег', async () => {
    vi.mocked(getSessionKey).mockReturnValue({ key: 'k' } as never);
    const onTagsChange = vi.fn();
    render(
      <NoteRow
        session={session}
        onOpen={vi.fn()}
        t={t}
        language="ru"
        userId="user_1"
        onTagsChange={onTagsChange}
      />,
    );

    expect(screen.queryByRole('button', { name: 'archive_add_tag_aria' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'archive_note_actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'archive_add_tag_aria' }));

    const input = await screen.findByRole('textbox', { name: 'archive_add_tag_aria' });
    await waitFor(() => expect(document.activeElement).toBe(input));

    fireEvent.change(input, { target: { value: 'gamma' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onTagsChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc_1' }), ['gamma']);
  });
});
