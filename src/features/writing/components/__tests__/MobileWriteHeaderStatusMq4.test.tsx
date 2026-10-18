// MQ-4: статус сохранения в шапке письма стоит слева, в одном слоте со временем; «Aa» —
// последний элемент строки и прижат к правому краю (блок min-w-60 после «Aa» выталкивал её).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { MobileWriteScreen } from '../MobileWriteScreen';
import { useTimerStore } from '../../store/useTimerStore';
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



describe('MQ-4: статус сохранения в шапке', () => {
  beforeEach(() => {
    cleanup();
    useContentStore.setState({ content: 'текст', wordCount: 1 });
    useTimerStore.setState({ status: 'writing', sessionType: 'free', wordGoal: 0, timerDuration: 0, sessionStartWords: 0, sessionStartSeconds: 0 } as Partial<ReturnType<typeof useTimerStore.getState>>);
  });

  it('«Aa» — последний элемент шапки, справа от неё ничего нет', () => {
    renderScreen({ status: 'writing', saveStatus: 'saved' });
    const aa = screen.getByRole('button', { name: 'settings_title' });
    expect(aa.nextElementSibling, 'после «Aa» остался блок статуса').toBeNull();
  });

  // U-16 (2026-10-18): «сохраняю / сохранено» — значком, как на десктопе; ошибка — текстом.
  it('«сохраняю» — значок слева от настроек; ошибка — текстом не шире 40 % строки', () => {
    renderScreen({ status: 'writing', saveStatus: 'saving' });
    const icon = screen.getByTestId('save-status');
    const aa = screen.getByRole('button', { name: 'settings_title' });
    expect(icon.compareDocumentPosition(aa) & Node.DOCUMENT_POSITION_FOLLOWING, 'статус стоит после настроек').toBeTruthy();
    expect(screen.queryByTestId('save-status-text'), 'текст вместо значка').toBeNull();
    cleanup();
    renderScreen({ status: 'writing', saveStatus: 'error' });
    const status = screen.getByTestId('save-status-text');
    expect(status.textContent).toBe('editor_error_save');
    expect(status.className).toContain('max-w-[40%]');
    expect(status.className).toContain('truncate');
  });

  it('пока статуса нет, пустого блока в строке нет', () => {
    renderScreen({ status: 'writing', saveStatus: 'idle' });
    expect(screen.queryByTestId('save-status-text')).toBeNull();
    expect(screen.queryByTestId('save-status')).toBeNull();
  });
});
