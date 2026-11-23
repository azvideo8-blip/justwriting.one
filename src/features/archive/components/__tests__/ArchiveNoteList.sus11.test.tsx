// NB-8 (sus11, вход «список архива»): разбор прошёл, а вектор не построен
// (indexed: daily/rate/error) — warning «в поиск по смыслу пока не вошло»,
// а не зелёное «Заметка разобрана». Отказ чтения карты разобранности —
// LoadNotice с повтором, а не «все не разобраны» и необработанный reject.
// Мутации: убрать ветки indexed (снова только res.ok) / убрать catch у
// loadAiProcessedMap — красный; откат — зелёный.
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
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

const session: ArchiveSession = {
  id: 'n1', userId: 'u1', title: 'Синтетика', content: 'синтетический текст', duration: 60, wordCount: 2, charCount: 5, wpm: 2, createdAt: Date.now(), _isLocal: true,
};

const onAnalyzeNote = vi.fn();
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
        onAnalyzeNote={onAnalyzeNote} loadAiProcessedMap={loadAiProcessedMap}
      />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  loadAiProcessedMap.mockResolvedValue({});
  onAnalyzeNote.mockResolvedValue({ ok: true, indexed: 'ok' });
});

describe('NB-8: список — итог разбора называет вектор', () => {
  it('indexed=daily — warning про лимит, не «разобрана»', async () => {
    onAnalyzeNote.mockResolvedValue({ ok: true, indexed: 'daily' });
    renderList();
    fireEvent.click(await screen.findByTitle(/Разобрать заметку через ИИ/));
    expect(await screen.findByText('ai_note_analyzed_index_limit')).toBeTruthy();
    expect(screen.queryByText('ai_note_analyzed')).toBeNull();
  });

  it('indexed=error — warning про ошибку индексации', async () => {
    onAnalyzeNote.mockResolvedValue({ ok: true, indexed: 'error' });
    renderList();
    fireEvent.click(await screen.findByTitle(/Разобрать заметку через ИИ/));
    expect(await screen.findByText('ai_note_analyzed_index_error')).toBeTruthy();
    expect(screen.queryByText('ai_note_analyzed')).toBeNull();
  });

  it('контроль: indexed=ok — зелёное «разобрана»', async () => {
    renderList();
    fireEvent.click(await screen.findByTitle(/Разобрать заметку через ИИ/));
    expect(await screen.findByText('ai_note_analyzed')).toBeTruthy();
  });

  it('карта разобранности не прочиталась — LoadNotice, повтор перечитывает', async () => {
    loadAiProcessedMap.mockRejectedValueOnce(new Error('IDB down')).mockResolvedValue({ n1: true });
    renderList();
    expect(await screen.findByText('archive_ai_map_load_error')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.queryByText('archive_ai_map_load_error')).toBeNull());
    expect(loadAiProcessedMap).toHaveBeenCalledTimes(2);
  });

  it('контроль: карта прочиталась — плашки нет', async () => {
    renderList();
    await screen.findByTitle(/Разобрать заметку через ИИ/);
    expect(screen.queryByText('archive_ai_map_load_error')).toBeNull();
  });
});