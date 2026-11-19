// d39e: дзен-строка письма теряет причину отказа сохранения.
// Настоящий MobileWriteScreen; моки только контекстов настроек/сессии,
// сторы — настоящие zustand-сторы приложения.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement as h } from 'react';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@/core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    isZenActive: true,
    zenModeEnabled: true,
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
vi.mock('@/core/settings/SettingsContext', () => ({ useSettings: () => ({ openSettings: vi.fn() }) }));
vi.mock('@/features/writing/contexts/WritingSessionContext', () => ({
  useWritingSessionContext: () => ({
    flow: { setupMode: 'none', openHelp: false, setOpenHelp: vi.fn() },
    actions: {},
    session: { saveStatus: 'saved', saveErrorKind: null },
    streakDays: 0,
    handlePlayRef: { current: null },
    keystrokeTrackerRef: { current: null },
    showZen: true,
    reducedMotion: true,
  }),
}));
vi.mock('@/shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('@/core/sync/useSyncStatus', () => ({ useSyncStatus: () => ({ status: 'synced', pendingCount: 0 }) }));
vi.mock('@/shared/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('@/core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: () => ({ isVaultUnlocked: true, encryptionMode: 'none' }),
  useVaultStatus: () => ({ isVaultActive: false, isVaultUnlocked: true }),
}));

import { MobileWriteScreen } from '@/features/writing/components/MobileWriteScreen';
import { useTimerStore } from '@/features/writing/store/useTimerStore';
import { useContentStore } from '@/features/writing/store/useContentStore';
import { LanguageProvider } from '@/shared/i18n';

function renderScreen(overrides: Record<string, unknown> = {}) {
  return render(
    h(LanguageProvider, null,
      h(MobileWriteScreen, {
        onPlay: vi.fn(), onStop: vi.fn(), status: 'writing', streakDays: 0,
        sessionType: 'free', onOpenSetup: vi.fn(),
        ...overrides,
      } as never)),
  );
}

beforeEach(() => {
  cleanup();
  useContentStore.setState({ content: 'MARKER_DAILY_TEXT', wordCount: 1 });
  useTimerStore.setState({ status: 'writing', sessionType: 'free', wordGoal: 0, timerDuration: 0, sessionStartWords: 0, sessionStartSeconds: 0 } as never);
});

describe('d39e: в дзене причина отказа сохранения та же, что в обычной шапке', () => {
  it('quota: дзен-строка называет нехватку места, а не «Ошибка сохранения»', () => {
    renderScreen({ saveStatus: 'error', saveErrorKind: 'quota' });
    expect(screen.getByTestId('zen-header-row').textContent).toContain('Недостаточно места на устройстве');
  });

  it('cloud-too-large: дзен-строка называет размер, а не «Сохранено здесь»', () => {
    renderScreen({ saveStatus: 'cloud-stale', saveErrorKind: 'cloud-too-large' });
    expect(screen.getByTestId('zen-header-row').textContent).toContain('Велик для облака');
  });

  it('КОНТРОЛЬ: дзен-строка при отказе без причины показывает «Ошибка сохранения»', () => {
    renderScreen({ saveStatus: 'error', saveErrorKind: undefined });
    expect(screen.getByTestId('zen-header-row').textContent).toContain('Ошибка сохранения');
  });
});
