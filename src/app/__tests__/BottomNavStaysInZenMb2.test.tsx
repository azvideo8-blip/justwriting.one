import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../AppShell';

// MB-2: в мобильном макете нижняя панель остаётся и в дзене. До правки AppShell
// не рендерил BottomNav при showZen, и на телефоне в дзене не было ни вкладок,
// ни пути завершить сессию (F-1).

const zen = vi.hoisted(() => ({ isZenActive: true }));
const layout = vi.hoisted(() => ({ mode: 'mobile' as 'mobile' | 'desktop' }));

vi.mock('../../features/auth/hooks/useAuthStatus', () => ({ useAuthStatus: () => ({ user: { uid: 'u_zen' }, isGuest: false }) }));
vi.mock('../../features/auth/hooks/useAdminStatus', () => ({ useAdminStatus: () => ({ isAdmin: false }) }));
vi.mock('../../features/auth/contexts/LoginModalContext', () => ({ useLoginModal: () => ({ loginModalOpen: false }) }));
vi.mock('../../core/settings/SettingsContext', () => ({ useSettings: () => ({ openSettings: vi.fn() }) }));
vi.mock('../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({ isZenActive: zen.isZenActive, zenModeEnabled: true, silenceMode: false }),
}));
vi.mock('../../shared/hooks/useLayoutMode', () => ({ useLayoutMode: () => ({ layoutMode: layout.mode }) }));
vi.mock('../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('../../core/sync/useSyncStatus', () => ({ useSyncStatus: () => ({ status: 'synced', pendingCount: 0 }) }));
vi.mock('../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../features/encryption/hooks/useEncryptionSetup', () => ({ useEncryptionSetup: () => ({ mode: 'none', check: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('../../core/sync/useEmptyDeviceDetection', () => ({ useEmptyDeviceDetection: () => ({ shouldPrompt: false, localCount: 0, cloudCount: 0, dismiss: vi.fn() }) }));
vi.mock('../../features/auth/hooks/useOtherUserDetection', () => ({ useOtherUserDetection: () => ({ hasOtherData: false, dismiss: vi.fn(), clear: vi.fn() }) }));
vi.mock('../../shared/hooks/useMobileLayoutAccess', () => ({ useMobileLayoutAccess: () => false }));
vi.mock('../AppRoutes', () => ({ AppRoutes: () => null }));
vi.mock('../ActivityLogBadge', () => ({ ActivityLogBadge: () => null }));
vi.mock('../../features/navigation/components/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../../features/navigation/components/BottomNav', () => ({ BottomNav: () => <div data-testid="bottom-nav" /> }));
vi.mock('../../features/writing/components/ConnectionStatusBanner', () => ({ ConnectionStatusBanner: () => null }));
vi.mock('../../core/theme/ThemeBackground', () => ({ ThemeBackground: () => null }));
vi.mock('../../features/auth/components/LoginModalOverlay', () => ({ LoginModalOverlay: () => null }));
vi.mock('../../features/encryption/components/RecoveryCodeGate', () => ({ RecoveryCodeGate: () => null }));
vi.mock('../../features/auth/components/GuestMigrationGate', () => ({ GuestMigrationGate: () => null }));
vi.mock('../../shared/components/ConfirmDialog', () => ({ ConfirmDialogRenderer: () => null, useConfirmDialog: () => ({ confirm: async () => true }) }));

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AppShell />
    </MemoryRouter>,
  );
}

function mainClasses(): string {
  return document.getElementById('main-content')?.className ?? '';
}

describe('MB-2: нижняя панель и отступ в дзене', () => {
  it('мобильный макет + дзен: BottomNav на месте', () => {
    layout.mode = 'mobile';
    zen.isZenActive = true;
    renderShell();
    expect(screen.getByTestId('bottom-nav')).toBeTruthy();
  });

  it('мобильный макет + дзен: отступ main остаётся под панель', () => {
    layout.mode = 'mobile';
    zen.isZenActive = true;
    renderShell();
    // MB-7 поднял отступ до pb-28 — под панель (72) плюс чип «Активность» (32).
    // Смысл этой проверки не изменился: в дзене он не должен уменьшаться.
    expect(mainClasses()).toContain('pb-28');
    expect(mainClasses()).not.toContain('pb-4');
  });

  it('десктоп + дзен: как сегодня — без нижней панели и с боковым отступом', () => {
    layout.mode = 'desktop';
    zen.isZenActive = true;
    renderShell();
    expect(screen.queryByTestId('bottom-nav')).toBeNull();
    expect(mainClasses()).toContain('pl-20');
  });
});
