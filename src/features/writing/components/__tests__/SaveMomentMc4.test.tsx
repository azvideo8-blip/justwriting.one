// MC-4: после «Сохранить» на телефоне нет тоста — есть тихая строка «Записано ·
// 36 слов» на 1,2 с, серия догоняет на месте, а «ещё не в облаке» остаётся
// видимым предупреждением на 3 с. Десктоп по-прежнему тостит.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { WritingFinishModal } from '../WritingFinishModal';
import { MobileWriteScreen } from '../MobileWriteScreen';
import { useContentStore } from '../../store/useContentStore';
import { useTimerStore } from '../../store/useTimerStore';
import { useSessionMetaStore } from '../../store/useSessionMetaStore';
import { useSaveMomentStore } from '../../store/useSaveMomentStore';

let layoutMode: 'desktop' | 'mobile' = 'mobile';

const mockShowToast = vi.fn();
vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
  ToastProvider: ({ children }: { children: unknown }) => <>{children}</>,
}));
vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode, setLayoutMode: vi.fn() }),
}));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));
vi.mock('../../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    quietStats: false,
    setQuietStats: vi.fn(),
    aiPanelOpen: false,
    setAiPanelOpen: vi.fn(),
    editorWidth: 'normal',
    zenSeenOnce: true,
    fontFamily: 'Inter',
    fontSize: 18,
    streamMode: false,
    toggleStreamMode: vi.fn(),
    autoHideCursor: false,
    isZenActive: false,
    zenModeEnabled: false,
    lifeLogVisible: false,
    headerVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
    effectiveHeaderVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
  }),
}));
vi.mock('../../../../core/settings/SettingsContext', () => ({
  useSettings: () => ({ openSettings: vi.fn() }),
}));
vi.mock('../../features/writing/contexts/WritingSessionContext', () => ({
  useWritingSessionContext: () => ({
    flow: { setupMode: 'none', openHelp: false, setOpenHelp: vi.fn() },
    actions: {},
    session: { saveStatus: 'saved', saveErrorKind: null },
    streakDays: 1,
    handlePlayRef: { current: null },
    keystrokeTrackerRef: { current: null },
    showZen: false,
    reducedMotion: true,
  }),
}));
vi.mock('../../../../shared/hooks/useKeyboardState', () => ({
  useKeyboardState: () => ({ overlay: 0, up: false }),
}));
vi.mock('../../hooks/useDictation', () => ({
  useDictation: () => ({ isListening: false, toggle: vi.fn(), hasSupport: false, isVaultActive: false, aiNoticeRemaining: null }),
}));
vi.mock('../AIToggleButton', () => ({ AIToggleButton: () => null }));
vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ profile: null, user: null, isGuest: false }),
}));
vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    AnimatePresence: ({ children }: any) => <>{children}</>,
    motion: {
      div: ({ children, className, onClick, ...props }: any) => (
        <div className={className} onClick={onClick} {...props}>{children}</div>
      ),
      p: ({ children, className, ...props }: any) => <p className={className} {...props}>{children}</p>,
      button: ({ children, className, onClick, ...props }: any) => (
        <button className={className} onClick={onClick} {...props}>{children}</button>
      ),
    },
    useReducedMotion: () => true,
  };
});
vi.mock('../WpmChart', () => ({ WpmChart: () => <div data-testid="wpm-chart" /> }));
vi.mock('../../../lifeLog/hooks/useCorpusDf', () => ({
  buildCorpusDf: vi.fn().mockResolvedValue({ df: new Map(), N: 0 }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

function seedStore() {
  useContentStore.setState({ content: 'Глина сохнет быстро.', wordCount: 36, initialWordCount: 0, wpm: 40 });
  useTimerStore.setState({
    seconds: 40, sessionStartSeconds: 0, accumulatedDuration: 40, totalPauseSeconds: 0,
    wordGoalReached: false, timeGoalReached: false, status: 'idle',
  } as Partial<ReturnType<typeof useTimerStore.getState>>);
  useSessionMetaStore.setState({ savedDocumentId: 'doc_1', sessionStartTime: Date.now() });
}

function saveWith(result: { docId: string; cloudSynced: boolean; isTooLarge?: boolean }) {
  const onSave = vi.fn().mockResolvedValue(result);
  render(<WritingFinishModal isOpen onCancel={vi.fn()} onSave={onSave} />);
  fireEvent.click(screen.getByRole('button', { name: 'common_save' }));
  return onSave;
}

describe('MC-4: конец сохранения на телефоне', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    layoutMode = 'mobile';
    useSaveMomentStore.setState({ moment: null });
    seedStore();
  });

  it('успех: тоста нет, вместо него — строка в сторе', async () => {
    saveWith({ docId: 'doc_1', cloudSynced: true });
    await waitFor(() => expect(useSaveMomentStore.getState().moment).not.toBeNull());
    expect(mockShowToast).not.toHaveBeenCalledWith('save_success', 'success');
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(useSaveMomentStore.getState().moment?.warningText).toBeNull();
  });

  it('«только на устройстве» не теряется: тот же текст строкой-предупреждением', async () => {
    saveWith({ docId: 'doc_1', cloudSynced: false, isTooLarge: false });
    await waitFor(() => expect(useSaveMomentStore.getState().moment).not.toBeNull());
    const text = useSaveMomentStore.getState().moment?.warningText ?? '';
    expect(['save_local_device_only', 'save_local_only_queued']).toContain(text);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  // Ревью 0.9.40: «Обсудить с ИИ» уводит на /ai, где строки экрана письма нет —
  // предупреждение «не в облаке» обязано прийти тостом. Мутация: убрать тост для
  // discuss → красный.
  it('«Обсудить с ИИ» + «только на устройстве» — предупреждение тостом', async () => {
    const onSave = vi.fn().mockResolvedValue({ docId: 'doc_1', cloudSynced: false, isTooLarge: false });
    render(<WritingFinishModal isOpen onCancel={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getAllByRole('button', { name: /finish_discuss_ai/ })[0]!);
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(
      expect.stringMatching(/save_local_device_only|save_local_only_queued/), undefined,
    ));
  });

  it('слишком большая заметка — предупреждение, а не «Записано»', async () => {
    saveWith({ docId: 'doc_1', cloudSynced: false, isTooLarge: true });
    await waitFor(() => expect(useSaveMomentStore.getState().moment?.warningText).toBe('save_too_large_cloud_warning'));
  });
});

describe('MC-4: десктоп по-прежнему тостит', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    layoutMode = 'desktop';
    useSaveMomentStore.setState({ moment: null });
    seedStore();
  });

  it('успех — тост, предупреждение «только на устройстве» — тоже тост', async () => {
    saveWith({ docId: 'doc_1', cloudSynced: true });
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('save_success', 'success'));
    expect(useSaveMomentStore.getState().moment).toBeNull();

    cleanup();
    vi.clearAllMocks();
    seedStore();
    saveWith({ docId: 'doc_2', cloudSynced: false, isTooLarge: false });
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(
      expect.stringMatching(/save_local_device_only|save_local_only_queued/),
    ));
  });
});

describe('MC-4: строка в шапке письма', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    layoutMode = 'mobile';
    seedStore();
    useSaveMomentStore.setState({ moment: null });
    vi.useFakeTimers();
  });
  afterEach(() => { vi.useRealTimers(); });

  function renderScreen() {
    return render(
      <MobileWriteScreen
        onPlay={vi.fn()}
        onStop={vi.fn()}
        status="idle"
        streakDays={1}
        sessionType="free"
        onOpenSetup={vi.fn()}
      />,
    );
  }

  it('«Записано · N слов» видна, через 1,2 с исчезает', () => {
    useSaveMomentStore.setState({ moment: { id: 1, words: 36, streakDays: 1, warningText: null, text: '' } });
    renderScreen();
    const line = screen.getByTestId('save-moment');
    expect(line.textContent).toContain('save_moment_saved');
    expect(line.textContent).toContain('archive_word_count');
    act(() => { vi.advanceTimersByTime(1_300); });
    expect(screen.queryByTestId('save-moment')).toBeNull();
  });

  it('предупреждение живёт 3 с', () => {
    useSaveMomentStore.setState({ moment: { id: 2, words: 36, streakDays: null, warningText: 'save_local_device_only', text: '' } });
    renderScreen();
    expect(screen.getByTestId('save-moment').textContent).toContain('save_local_device_only');
    act(() => { vi.advanceTimersByTime(1_300); });
    expect(screen.getByTestId('save-moment'), 'предупреждение пропало слишком рано').toBeTruthy();
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(screen.queryByTestId('save-moment')).toBeNull();
  });

  it('серия выросла — в строке появляется хвост про серию', () => {
    useSaveMomentStore.setState({ moment: { id: 3, words: 36, streakDays: 2, warningText: null, text: '' } });
    renderScreen();
    expect(screen.getByTestId('save-moment').textContent).toContain('save_moment_streak');
  });

  it('без момента шапка обычная: токен серии на месте', () => {
    renderScreen();
    expect(screen.queryByTestId('save-moment')).toBeNull();
    expect(screen.getByText(/home_streak_days/)).toBeInTheDocument();
  });

  it('призрак сохранённого текста гаснет над пустым редактором', () => {
    useContentStore.setState({ content: '', wordCount: 0 });
    useSaveMomentStore.setState({ moment: { id: 4, words: 36, streakDays: null, warningText: null, text: 'Глина сохнет быстро.' } });
    const { container } = renderScreen();
    const ghost = Array.from(container.querySelectorAll('p')).find(p => p.textContent === 'Глина сохнет быстро.');
    expect(ghost, 'призрака текста нет').toBeTruthy();
    expect(ghost!.getAttribute('aria-hidden')).toBe('true');
  });
});
