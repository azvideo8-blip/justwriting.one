import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../AppShell';
import { EarlierQuestionOpenContext } from '../onboardingQueue';

// Первый вход на новом устройстве: «Загрузка данных из облака» ложилась поверх
// «Синхронизации с облаком» (аудит диалогов, раунд 2, 2026-10-07). Окно загрузки
// ждёт, пока вопрос PrivacyGuard открыт.

vi.mock('../../features/auth/hooks/useAuthStatus', () => ({ useAuthStatus: () => ({ user: { uid: 'u_queue' }, isGuest: false }) }));
vi.mock('../../features/auth/hooks/useAdminStatus', () => ({ useAdminStatus: () => ({ isAdmin: false }) }));
vi.mock('../../features/auth/contexts/LoginModalContext', () => ({ useLoginModal: () => ({ loginModalOpen: false }) }));
vi.mock('../../core/settings/SettingsContext', () => ({ useSettings: () => ({ openSettings: vi.fn() }) }));
vi.mock('../../core/settings/WritingSettingsContext', () => ({ useWritingSettings: () => ({ isZenActive: false, zenModeEnabled: false, silenceMode: false }) }));
vi.mock('../../shared/hooks/useLayoutMode', () => ({ useLayoutMode: () => ({ layoutMode: 'desktop' }) }));
vi.mock('../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('../../core/sync/useSyncStatus', () => ({ useSyncStatus: () => ({ status: 'synced', pendingCount: 0 }) }));
vi.mock('../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../features/encryption/hooks/useEncryptionSetup', () => ({ useEncryptionSetup: () => ({ mode: 'none', check: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('../../core/sync/useEmptyDeviceDetection', () => ({
  useEmptyDeviceDetection: () => ({ shouldPrompt: true, localCount: 0, cloudCount: 59, dismiss: vi.fn() }),
}));
vi.mock('../../features/auth/hooks/useOtherUserDetection', () => ({ useOtherUserDetection: () => ({ hasOtherData: false, dismiss: vi.fn(), clear: vi.fn() }) }));
vi.mock('../modals/RestoreFromCloudModal', () => ({ RestoreFromCloudModal: () => <div data-testid="restore-from-cloud" /> }));
vi.mock('../AppRoutes', () => ({ AppRoutes: () => null }));
vi.mock('../ActivityLogBadge', () => ({ ActivityLogBadge: () => null }));
vi.mock('../../features/navigation/components/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../../features/navigation/components/BottomNav', () => ({ BottomNav: () => null }));
vi.mock('../../features/writing/components/ConnectionStatusBanner', () => ({ ConnectionStatusBanner: () => null }));
vi.mock('../../core/theme/ThemeBackground', () => ({ ThemeBackground: () => null }));
vi.mock('../../features/auth/components/LoginModalOverlay', () => ({ LoginModalOverlay: () => null }));
vi.mock('../../features/encryption/components/RecoveryCodeGate', () => ({ RecoveryCodeGate: () => null }));
vi.mock('../../features/auth/components/GuestMigrationGate', () => ({ GuestMigrationGate: () => null }));
vi.mock('../../shared/components/ConfirmDialog', () => ({ ConfirmDialogRenderer: () => null, useConfirmDialog: () => ({ confirm: async () => true }) }));

function renderShell(questionOpen: boolean) {
  return render(
    <MemoryRouter>
      <EarlierQuestionOpenContext.Provider value={questionOpen}>
        <AppShell />
      </EarlierQuestionOpenContext.Provider>
    </MemoryRouter>,
  );
}

describe('окна первого входа — по одному', () => {
  it('пока открыт вопрос о синхронизации, загрузка из облака ждёт', async () => {
    renderShell(true);
    // окно ленивое: даём импорту время, за которое второй тест его уже видит
    await new Promise(r => setTimeout(r, 1_000));
    expect(screen.queryByTestId('restore-from-cloud')).toBeNull();
  });

  it('после ответа загрузка из облака появляется', async () => {
    renderShell(false);
    expect(await screen.findByTestId('restore-from-cloud')).toBeTruthy();
  });
});
