// MQ-2: заметка без названия называется одинаково в строке списка, листе действий и читалке —
// первой фразой текста (`splitNoteTitle`); «Без названия» остаётся только у пустой заметки.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithProviders } from '../../../../test/utils/render';
import { ToastProvider } from '../../../../shared/components/Toast';
import { DocumentPreview } from '../DocumentPreview';
import { NoteRow } from '../NoteRow';
import type { ArchiveSession } from '../../types';

vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode: 'mobile', setLayoutMode: vi.fn() }),
}));
vi.mock('../../../../core/services/StorageService', () => ({
  StorageService: { addLocalCopy: vi.fn(), addCloudCopy: vi.fn(), removeLocalCopy: vi.fn(), removeCloudCopy: vi.fn(), trashDocument: vi.fn() },
}));
vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: { unlinkFromCloud: vi.fn(), clearLocalOnlyForUpload: vi.fn() },
}));

const make = (over: Partial<ArchiveSession>): ArchiveSession => ({
  id: 'doc-mq2', userId: 'user-mq2', title: '', content: 'Вечером тревожно. Не могу объяснить почему, просто сижу и пишу.',
  duration: 120, wordCount: 10, charCount: 60, wpm: 5, tags: [], createdAt: new Date(2026, 9, 14, 19, 5).getTime(), _isLocal: true,
  ...over,
} as unknown as ArchiveSession);

type PreviewProps = ComponentProps<typeof DocumentPreview>;
const renderReader = (session: ArchiveSession) => renderWithProviders(
  <MemoryRouter><ToastProvider>
    <DocumentPreview {...({
      session, onClose: vi.fn(), onContinue: vi.fn(), onTagsChange: vi.fn(), onLabelChange: vi.fn(), onAddLabel: vi.fn(),
      labels: [], allTags: [], onAnalyzeNote: vi.fn(), fetchSummary: vi.fn().mockResolvedValue(null), fetchRelatedNotes: vi.fn().mockResolvedValue([]),
    } as PreviewProps)} />
  </ToastProvider></MemoryRouter>,
);

describe('MQ-2: один заголовок у заметки без названия', () => {
  beforeEach(() => cleanup());

  it('читалка называет заметку первой фразой, а не «Без названия»', () => {
    renderReader(make({}));
    const reader = screen.getByTestId('note-reader');
    expect(reader.getAttribute('aria-label')).toBe('Вечером тревожно.');
    expect(within(reader).queryByText('Без названия')).toBeNull();
    expect(within(reader).getByRole('heading', { name: 'Вечером тревожно.' })).toBeTruthy();
  });

  it('строка списка, лист действий и читалка показывают одно и то же', () => {
    const session = make({});
    const seen: Record<string, string | null | undefined> = {};

    const row = renderWithProviders(
      <MemoryRouter><ToastProvider>
        <NoteRow session={session} onOpen={vi.fn()} t={(k: string) => k} language="ru" userId="user_1" onTagsChange={vi.fn()} onDelete={vi.fn()} />
      </ToastProvider></MemoryRouter>,
    );
    seen.row = screen.getByText('Вечером тревожно.').textContent;
    fireEvent.click(screen.getByRole('button', { name: 'archive_note_actions' }));
    const sheet = screen.getByRole('dialog', { name: 'Действия с заметкой' });
    seen.sheet = sheet.querySelector('.line-clamp-2')?.textContent;
    row.unmount();
    cleanup();

    renderReader(session);
    seen.reader = screen.getByTestId('note-reader').getAttribute('aria-label');

    expect(seen).toEqual({ row: 'Вечером тревожно.', sheet: 'Вечером тревожно.', reader: 'Вечером тревожно.' });
  });

  it('у пустой заметки «Без названия» остаётся', () => {
    renderReader(make({ content: '' }));
    expect(screen.getByTestId('note-reader').getAttribute('aria-label')).toBe('Без названия');
  });

  it('своё название важнее первой фразы', () => {
    renderReader(make({ title: 'Про тревогу' }));
    expect(screen.getByTestId('note-reader').getAttribute('aria-label')).toBe('Про тревогу');
  });
});
