// d39a: мобильный «Профиль» обязан отличать сбой чтения от пустого аккаунта.
// Настоящие MobileMeScreen + useProfileStats; мок только края данных
// (loadAllSessions — обёртка над IndexedDB/облаком) и презентационных детей.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement as h } from 'react';
import { render, screen, cleanup, waitFor, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const loadAllSessions = vi.hoisted(() => vi.fn());
vi.mock('@/core/services/UnifiedSessionLoader', () => ({
  loadAllSessions,
  loadSessionContent: vi.fn(),
  hydrateSessionContent: vi.fn(),
}));
vi.mock('@/core/utils/streakFreeze', async (orig) => ({ ...(await orig<object>()), syncStreakFreezesWithCloud: vi.fn(async () => {}) }));
vi.mock('@/shared/errors/reportError', () => ({ reportError: vi.fn() }));

vi.mock('@/shared/hooks/useLayoutMode', () => ({ useLayoutMode: () => ({ layoutMode: 'mobile', setLayoutMode: vi.fn() }) }));
vi.mock('@/features/profile/components/KPIStrip', () => ({ KPIStrip: () => h('div', { 'data-testid': 'kpi' }) }));
vi.mock('@/features/profile/components/StreakRibbon', () => ({ StreakRibbon: () => null }));
vi.mock('@/features/profile/components/Heatmap', () => ({ Heatmap: () => null }));
vi.mock('@/features/profile/components/HourRhythm', () => ({ HourRhythm: () => null }));
vi.mock('@/features/profile/components/Achievements', () => ({ Achievements: () => null }));
vi.mock('@/features/profile/components/MoodTrend', () => ({ MoodTrend: () => null }));
vi.mock('@/features/profile/components/ProfileHero', () => ({ ProfileHero: () => null }));
vi.mock('@/app/pages/MeAccountSection', () => ({ MeAccountSection: () => null }));
vi.mock('@/core/sync/useSyncStatus', () => ({ useSyncStatus: () => ({ status: 'synced', pendingCount: 0, aiStorePendingCount: 0, aiStoreDeadCount: 0 }) }));
vi.mock('@/shared/activity/useActivityLogStore', () => ({
  useActivityLogStore: (cb: (s: { entries: unknown[]; setPanelOpen: (v: boolean) => void }) => unknown) =>
    cb({ entries: [], setPanelOpen: vi.fn() }),
}));
vi.mock('@/core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: (cb: (s: { isVaultUnlocked: boolean }) => unknown) => cb({ isVaultUnlocked: true }),
}));
vi.mock('@/core/crypto/useVaultPasswordOutOfSync', () => ({ useVaultPasswordOutOfSync: () => false }));
vi.mock('@/features/auth/hooks/useAdminStatus', () => ({ useAdminStatus: () => ({ isAdmin: false }) }));
vi.mock('@/features/settings/hooks/useConfirmSignOut', () => ({ useConfirmSignOut: () => vi.fn() }));
vi.mock('@/app/useLoginModal', () => ({ useLoginModal: () => ({ openLoginModal: vi.fn() }) }));

import { MobileMeScreen } from '@/app/pages/MobileMeScreen';
import { useProfileStats } from '@/features/profile/hooks/useProfileStats';
import { ToastProvider } from '@/shared/components/Toast';
import { LanguageProvider } from '@/shared/i18n';

const user = { uid: 'u-d39a', email: 'd39a@example.test', metadata: { creationTime: Date.now() - 86_400_000 } } as never;

function renderScreen() {
  return render(
    h(LanguageProvider, null,
      h(ToastProvider, null,
        h(MemoryRouter, null, h(MobileMeScreen, { user, profile: { streakDays: 3 } as never })))),
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('d39a: сбой чтения профиля на телефоне — не «пустой аккаунт»', () => {
  it('loadAllSessions бросил — экран называет ошибку, а не рисует нули', async () => {
    loadAllSessions.mockRejectedValue(new Error('MARKER_DAILY_IDB_DOWN'));
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Ошибка загрузки профиля')).toBeTruthy();
    });
  });

  it('облако не прочиталось (cloudLoadFailed) — экран предупреждает, а не молчит', async () => {
    loadAllSessions.mockResolvedValue({ sessions: [], cloudLoadFailed: true });
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Облако не прочиталось — статистика только по этому устройству.')).toBeTruthy();
    });
  });

  it('КОНТРОЛЬ: хук отдаёт error=load_failed — сигнал есть, экран его теряет', async () => {
    loadAllSessions.mockRejectedValue(new Error('MARKER_DAILY_IDB_DOWN'));
    const { result } = renderHook(() => useProfileStats('u-d39a', user));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.error).toBe('load_failed');
    expect(result.current.sessions).toEqual([]);
  });
});
