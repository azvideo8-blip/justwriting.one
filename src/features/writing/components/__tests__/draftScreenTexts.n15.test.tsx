// N1-5: тексты экрана догоняют то, что реально гарантировано.
// 1) Гостю плашка «Найден несохранённый черновик.» обязана сказать про срок
//    (`GUEST_DRAFT_TTL_MS` = 7 суток); аккаунту — не говорить (облачная копия
//    черновика не истекает никогда, решение по D1-6).
// 2) Статус «облако не обновилось» больше не читается поломкой: короткая строка
//    + подсказка с обещанием автоматической досылки, которое держит
//    30-секундный интервал (`useDraftAutosave.ts:271-276`).
// Мутация: убрать гостеву строку из баннера и прежний `tip` в SaveStatus →
// оба кейса красные.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { MobileWriteScreen } from '../MobileWriteScreen';
import { SaveStatus } from '../SaveStatus';
import { useContentStore } from '../../store/useContentStore';
import { useTimerStore } from '../../store/useTimerStore';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));
vi.mock('../../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    isZenActive: false,
    zenModeEnabled: false,
    editorWidth: 'normal',
    zenSeenOnce: true,
    fontFamily: 'Inter',
    fontSize: 18,
    streamMode: false,
    toggleStreamMode: vi.fn(),
    autoHideCursor: false,
    aiPanelOpen: false,
    setAiPanelOpen: vi.fn(),
    lifeLogVisible: false,
    headerVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
    effectiveHeaderVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
  }),
}));
vi.mock('../../../../core/settings/SettingsContext', () => ({
  useSettings: () => ({ openSettings: vi.fn() }),
}));
vi.mock('../../../../features/writing/contexts/WritingSessionContext', () => ({
  useWritingSessionContext: () => ({
    flow: { setupMode: 'none', openHelp: false, setOpenHelp: vi.fn() },
    actions: {},
    session: { saveStatus: 'saved', saveErrorKind: null },
    streakDays: 0,
    handlePlayRef: { current: null },
    keystrokeTrackerRef: { current: null },
    showZen: false,
    reducedMotion: true,
  }),
}));
vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));
vi.mock('../../../../core/sync/useSyncStatus', () => ({
  useSyncStatus: () => ({ status: 'synced', pendingCount: 0 }),
}));
vi.mock('../../../../shared/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));
vi.mock('../../../../core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: () => ({ isVaultUnlocked: true, encryptionMode: 'none' }),
  useVaultStatus: () => ({ isVaultActive: false, isVaultUnlocked: true }),
}));

function renderScreen(overrides: Partial<ComponentProps<typeof MobileWriteScreen>> = {}) {
  return render(
    <MobileWriteScreen
      onPlay={vi.fn()}
      onStop={vi.fn()}
      status="idle"
      streakDays={0}
      sessionType="free"
      onOpenSetup={vi.fn()}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  cleanup();
  useContentStore.setState({ content: 'Текст черновика.', wordCount: 2 });
  useTimerStore.setState({ status: 'idle', sessionType: 'free', wordGoal: 0, timerDuration: 0, sessionStartWords: 0, sessionStartSeconds: 0 } as Partial<ReturnType<typeof useTimerStore.getState>>);
});

describe('N1-5: срок гостевого черновика в плашке', () => {
  it('гость видит вторую строку про 7 дней', () => {
    renderScreen({ hasDraft: true, draftInEditor: false, isGuest: true, userId: 'guest_n15' });

    expect(screen.getByText('draft_restore_prompt')).toBeInTheDocument();
    expect(screen.getByText('draft_restore_guest_ttl')).toBeInTheDocument();
  });

  it('аккаунту про 7 дней не показывается', () => {
    renderScreen({ hasDraft: true, draftInEditor: false, userId: 'u_n15' });

    expect(screen.getByText('draft_restore_prompt')).toBeInTheDocument();
    expect(screen.queryByText('draft_restore_guest_ttl')).toBeNull();
  });
});

describe('N1-5: статус «облако не обновилось»', () => {
  it('подсказка десктопа обещает автоматическую досылку', () => {
    render(<SaveStatus saveStatus="cloud-stale" />);

    const icon = screen.getByTestId('save-status');
    expect(icon.getAttribute('aria-label')).toContain('editor_cloud_stale');
    expect(icon.getAttribute('aria-label'), 'в подсказке нет обещания досылки')
      .toContain('editor_cloud_stale_hint');
  });

  // N1 вопрос 3: отказ навсегда — подсказка без обещания досылки.
  it('облако отказало навсегда — подсказка называет причину и досылку не обещает', () => {
    render(<SaveStatus saveStatus="cloud-stale" saveErrorKind="cloud-too-large" />);
    const label = screen.getByTestId('save-status').getAttribute('aria-label') ?? '';
    expect(label).toContain('editor_cloud_too_large_hint');
    expect(label).not.toContain('editor_cloud_stale_hint');
  });

  it('телефон: отказ навсегда показывает короткую причину вместо «Сохранено здесь»', () => {
    renderScreen({ saveStatus: 'cloud-stale', saveErrorKind: 'cloud-refused', userId: 'u_n15' } as Partial<ComponentProps<typeof MobileWriteScreen>>);
    expect(screen.getByTestId('save-status-text').textContent).toBe('editor_cloud_refused');
  });

  it('сохранённое состояние подсказку про облако не получает', () => {
    render(<SaveStatus saveStatus="saved" />);

    expect(screen.getByTestId('save-status').getAttribute('aria-label')).not.toContain('editor_cloud_stale_hint');
  });
});
