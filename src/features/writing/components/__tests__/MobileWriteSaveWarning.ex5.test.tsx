// EX-5 (PIN-1, телефон): строка момента сохранения с предупреждением — текст
// предупреждения вместо «сохранено», цвет предупреждения, держится SAVE_WARNING_MS.
// Экран настоящий; моки — края (i18n, контексты, тост, облако/сеть, сейф).
// Харнесс — из MobileWriteMotion.sa10. Мутации: игнорировать warningText; держать
// предупреждение SAVE_MOMENT_MS — красный.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';
import { useSaveMomentStore, SAVE_MOMENT_MS, SAVE_WARNING_MS } from '../../store/useSaveMomentStore';
import { MobileWriteScreen } from '../MobileWriteScreen';
import { useContentStore } from '../../store/useContentStore';

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
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../../core/sync/useSyncStatus', () => ({ useSyncStatus: () => ({ status: 'synced', pendingCount: 0 }) }));
vi.mock('../../../../shared/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('../../../../core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: () => ({ isVaultUnlocked: true, encryptionMode: 'none' }),
  useVaultStatus: () => ({ isVaultActive: false, isVaultUnlocked: true }),
}));

const WARNING = 'Сохранение не прошло: проверьте сеть и попробуйте ещё раз';

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

describe('EX-5: телефон — строка сохранения с предупреждением', () => {
  beforeEach(() => {
    cleanup();
    useContentStore.setState({ content: '', wordCount: 0 });
    useSaveMomentStore.setState({ moment: null });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('предупреждение заменяет «сохранено» и окрашено предупреждением', () => {
    act(() => { useSaveMomentStore.getState().announce({ words: 3, streakDays: null, warningText: WARNING, text: 'Синтетика' }); });
    renderScreen();
    const el = screen.getByText(WARNING);
    expect(el.closest('[class*="accent-warning"]')).not.toBeNull();
    expect(screen.queryByText('save_moment_saved', { exact: false })).toBeNull();
  });

  it('контроль: обычное сохранение — «сохранено», цвет успеха, предупреждения нет', () => {
    act(() => { useSaveMomentStore.getState().announce({ words: 3, streakDays: null, warningText: null, text: 'Синтетика' }); });
    renderScreen();
    const el = screen.getByText(/save_moment_saved/);
    expect(el.closest('[class*="accent-success"]')).not.toBeNull();
    expect(screen.queryByText(WARNING)).toBeNull();
  });

  it('предупреждение держится дольше обычной строки: SAVE_WARNING_MS, не SAVE_MOMENT_MS', () => {
    vi.useFakeTimers();
    act(() => { useSaveMomentStore.getState().announce({ words: 3, streakDays: null, warningText: WARNING, text: 'Синтетика' }); });
    renderScreen();
    act(() => { vi.advanceTimersByTime(SAVE_MOMENT_MS + 100); });
    expect(screen.queryByText(WARNING)).not.toBeNull();
    act(() => { vi.advanceTimersByTime(SAVE_WARNING_MS - SAVE_MOMENT_MS); });
    expect(useSaveMomentStore.getState().moment).toBeNull();
  });
});
