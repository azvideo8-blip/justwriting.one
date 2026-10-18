// U-37 (решение владельца 2026-10-18, Q-10): в листе долгого нажатия карточки
// сетки на телефоне есть «Добавить тег» — подвал карточки при этом не делают.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/utils/render';
import { GridNoteCard } from '../GridNoteCard';
import { ArchiveSession } from '../../types';
import { Label } from '../../../../types';

let layoutMode: 'desktop' | 'mobile' = 'mobile';

vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode, setLayoutMode: vi.fn() }),
}));
vi.mock('../../../../shared/components/ConfirmDialog', () => ({
  useConfirmDialog: () => ({ prompt: vi.fn().mockResolvedValue(null), confirm: vi.fn(), alert: vi.fn() }),
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../../app/useAuthStatus', () => ({ useAuthStatus: () => ({ profile: null, user: null }) }));
vi.mock('../../../../core/services/StorageService', () => ({
  StorageService: { addLocalCopy: vi.fn(), addCloudCopy: vi.fn(), removeLocalCopy: vi.fn(), removeCloudCopy: vi.fn(), trashDocument: vi.fn() },
}));
vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: { unlinkFromCloud: vi.fn(), clearLocalOnlyForUpload: vi.fn() },
}));

const labels: Label[] = [{ id: 'lbl_1', name: 'Работа', color: '#e0a458' }];

const session: ArchiveSession = {
  id: 'doc_u37',
  userId: 'u1',
  content: 'Глина сохнет быстрее, чем кажется. Поэтому круг крутят медленно.',
  duration: 300,
  wordCount: 42,
  sessionWordsAdded: 42,
  sittings: [],
  charCount: 64,
  wpm: 8,
  title: 'Про гончарный круг',
  tags: ['глина'],
  labelId: 'lbl_1',
  createdAt: new Date(2026, 9, 14, 9, 5),
  sessionStartTime: new Date(2026, 9, 14, 9, 5).getTime(),
  _isLocal: true,
};

function openSheet() {
  const onTagsChange = vi.fn();
  const view = renderWithProviders(
    <GridNoteCard session={session} onClick={vi.fn()} userId="user_1" labels={labels} allTags={['глина', 'семья']} onTagsChange={onTagsChange} />,
  );
  vi.useFakeTimers();
  const title = screen.getByText('Про гончарный круг');
  act(() => { fireEvent.touchStart(title, { touches: [{ clientX: 8, clientY: 8 }] }); });
  act(() => { vi.advanceTimersByTime(600); });
  act(() => { fireEvent.touchEnd(title); });
  vi.useRealTimers();
  return { ...view, onTagsChange };
}

describe('U-37: лист карточки сетки умеет добавлять тег', () => {
  beforeEach(() => {
    cleanup();
    layoutMode = 'mobile';
  });

  it('в листе есть строка «Добавить тег»', () => {
    openSheet();
    expect(screen.getByRole('dialog', { name: 'Действия с заметкой' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Добавить тег' }),
      'в листе карточки нет «Добавить тег»',
    ).toBeInTheDocument();
  });

  it('«Добавить тег» закрывает лист, а Enter добавляет тег в заметку', async () => {
    const { onTagsChange } = openSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить тег' }));
    // MQ-5: лист смонтирован ещё 250 мс после закрытия, чтобы успел сыграть уход.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Действия с заметкой' })).toBeNull());
    const input = screen.getByRole('textbox', { name: 'Добавить тег' });
    fireEvent.change(input, { target: { value: 'печь' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onTagsChange).toHaveBeenCalledWith(session, expect.arrayContaining(['глина', 'печь']));
  });
});
