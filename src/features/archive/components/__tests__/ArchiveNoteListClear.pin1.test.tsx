// PIN-1 (2026-11-21): удаление разбора в списке архива — отказ назван.
// Настоящий ArchiveNoteList, моки только краёв: виртуализация, auth,
// confirm-диалог. Харнесс — из ArchiveNoteList.sus11.
// Мутации: cloudSynced всегда success — красный (1); убрать ветку localFailed —
// красный (2); убрать catch-тост — красный (3).
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/utils/render';
import { ToastProvider } from '../../../../shared/components/Toast';
import { ArchiveNoteList } from '../ArchiveNoteList';
import type { ArchiveSession } from '../../types';
import { enUS } from 'date-fns/locale';

vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<object>()),
  useNavigate: () => vi.fn(),
}));
vi.mock('react-virtuoso', () => ({
  Virtuoso: (props: { data: ArchiveSession[]; itemContent: (i: number, s: ArchiveSession) => ReactNode }) => (
    <div data-testid="virt-list">{props.data.map((s, i) => <div key={s.id}>{props.itemContent(i, s)}</div>)}</div>
  ),
  VirtuosoGrid: () => <div data-testid="virt-grid" />,
}));
vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({
    user: { uid: 'u1' }, profile: null, refreshProfile: vi.fn().mockResolvedValue(undefined),
    authState: 'authenticated', isAuthenticated: true, isGuest: false, loading: false, isConnected: true,
  }),
}));
vi.mock('../../../../core/auth', async (orig) => ({
  ...(await orig<object>()),
  getCurrentUser: () => ({ uid: 'u1' }),
}));
vi.mock('../../../../shared/components/ConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm: vi.fn(async () => true) }),
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const session: ArchiveSession = {
  id: 'n1', userId: 'u1', title: 'Синтетика', content: 'синтетический текст', duration: 60, wordCount: 2, charCount: 5, wpm: 2, createdAt: Date.now(), _isLocal: true,
};

const onClearAnalysis = vi.fn();
const loadAiProcessedMap = vi.fn();

function renderList() {
  return renderWithProviders(
    <ToastProvider>
      <ArchiveNoteList
        viewMode="list"
        state={{ status: 'data', data: [session] }}
        groupedSessions={{}} sortedDates={[]} dateLocale={enUS} labels={[]} userId="u1"
        searchQuery="" isGroupedByDate={false}
        onOpen={vi.fn()} onDelete={vi.fn()} onTagsChange={vi.fn()} onTitleChange={vi.fn()}
        onDateChange={vi.fn()} onLabelChange={vi.fn()} onStorageChange={vi.fn()}
        t={(k: string) => k} language="en"
        onClearAnalysis={onClearAnalysis} loadAiProcessedMap={loadAiProcessedMap}
      />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  loadAiProcessedMap.mockResolvedValue({ n1: true });
  onClearAnalysis.mockResolvedValue({ cloudSynced: true });
});

async function clickClear() {
  renderList();
  fireEvent.click(await screen.findByTitle(/ai_note_clear|Удалить разбор ИИ/));
}

describe('PIN-1: удаление разбора — исход назван', () => {
  it('облако отказало — warning «только на устройстве», не зелёное «удалено»', async () => {
    onClearAnalysis.mockResolvedValue({ cloudSynced: false });
    await clickClear();
    expect(await screen.findByText('ai_note_cleared_local_only')).toBeTruthy();
    expect(screen.queryByText('ai_note_cleared')).toBeNull();
  });

  it('производные не удалились — error, не «удалено»', async () => {
    onClearAnalysis.mockResolvedValue({ cloudSynced: true, localFailed: true });
    await clickClear();
    expect(await screen.findByText('ai_note_clear_derivatives_failed')).toBeTruthy();
    expect(screen.queryByText('ai_note_cleared')).toBeNull();
  });

  it('бросок — error, не тишина', async () => {
    onClearAnalysis.mockRejectedValue(new Error('SYNTHETIC_CLEAR_THROW'));
    await clickClear();
    expect(await screen.findByText('error_generic_action')).toBeTruthy();
    expect(screen.queryByText('ai_note_cleared')).toBeNull();
  });

  it('контроль: всё удалено — зелёное «удалено»', async () => {
    await clickClear();
    expect(await screen.findByText('ai_note_cleared')).toBeTruthy();
  });
});