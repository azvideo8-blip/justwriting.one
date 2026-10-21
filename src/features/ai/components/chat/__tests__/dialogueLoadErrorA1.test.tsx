// A-1: сбой чтения диалогов — это не «пусто». Проверяем через настоящий
// useDialogueManager и настоящие AIDialogueService: мокается только край —
// IndexedDB (getLocalDb), как и при реальном сбое хранилища.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { useEffect } from 'react';
import { useDialogueManager } from '../../../hooks/useDialogueManager';
import { AIChatSidebar } from '../AIChatSidebar';
import { MobileDialogueListSheet } from '../MobileDialogueListSheet';
import type { AIDialogue } from '../../../../../core/storage/localDb';

const mocks = vi.hoisted(() => ({ getLocalDb: vi.fn() }));

vi.mock('../../../../../core/storage/localDb', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getLocalDb: mocks.getLocalDb };
});

vi.mock('../../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

const dialogue: AIDialogue = {
  id: 'dlg_after_retry',
  title: 'MARKER_A1_DIALOGUE',
  personaId: 'coach',
  personaName: 'Коуч',
  personaEmoji: '🙂',
  messages: [{ role: 'user', content: 'привет' }],
  createdAt: Date.now() - 1000,
  updatedAt: Date.now(),
} as AIDialogue;

function Harness({ variant }: { variant: 'sidebar' | 'sheet' }) {
  const manager = useDialogueManager({ confirmDialog: vi.fn().mockResolvedValue(true) });
  const loadDialogues = manager.loadDialogues;
  useEffect(() => { void loadDialogues(); }, [loadDialogues]);

  const shared = {
    dialogues: manager.dialogues,
    archivedDialogues: manager.archivedDialogues,
    activeDialogueId: manager.activeDialogueId,
    showArchived: manager.showArchived,
    setShowArchived: manager.setShowArchived,
    onSelectDialogue: vi.fn(),
    onUnarchive: vi.fn(),
    loading: manager.dialoguesLoading,
    loadError: manager.dialoguesLoadError,
    onRetry: () => { void manager.loadDialogues(); },
  };

  if (variant === 'sidebar') {
    return <AIChatSidebar {...shared} onNewDialogue={vi.fn()} />;
  }
  return (
    <MobileDialogueListSheet
      {...shared}
      open
      onClose={vi.fn()}
      onRename={vi.fn()}
      onArchive={vi.fn()}
      onDelete={vi.fn()}
    />
  );
}

describe.each(['sidebar', 'sheet'] as const)('A-1: сбой чтения диалогов (%s)', variant => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLocalDb.mockRejectedValue(new Error('MARKER_A1_IDB'));
  });
  afterEach(cleanup);

  it('показывает ошибку и «Повторить», а не «Нет активных диалогов»', async () => {
    render(<Harness variant={variant} />);
    await waitFor(() => expect(screen.getByText('ai_dialogues_load_error')).toBeTruthy());
    expect(screen.queryByText('ai_no_active_dialogues')).toBeNull();
    expect(screen.getByText('retry')).toBeTruthy();
  });

  it('«Повторить» после успешного чтения показывает список', async () => {
    render(<Harness variant={variant} />);
    await waitFor(() => expect(screen.getByText('ai_dialogues_load_error')).toBeTruthy());

    mocks.getLocalDb.mockResolvedValue({
      getAll: vi.fn().mockResolvedValue([dialogue]),
      delete: vi.fn(),
    });
    fireEvent.click(screen.getByText('retry'));

    await waitFor(() => expect(screen.getByText('MARKER_A1_DIALOGUE')).toBeTruthy());
    expect(screen.queryByText('ai_dialogues_load_error')).toBeNull();
  });
});
