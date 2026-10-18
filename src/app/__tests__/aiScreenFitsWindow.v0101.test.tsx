import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../AppShell';

// Скрин владельца 2026-10-17 (iPhone): на экране ИИ не видно шапки (☰, собеседник,
// «+») — страница выше окна. Корень оболочки ИИ на телефоне получал и
// `min-h-screen` (min-height: 100vh), и `h-[100dvh]`: когда панель браузера видна,
// 100vh больше видимой высоты и минимум побеждает — документ прокручивался, и
// scrollIntoView чата уводил шапку вверх. Мутация: убрать min-h-0 → красный.

const zen = vi.hoisted(() => ({ isZenActive: false }));
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

function rootClasses(): string {
  return (document.getElementById('main-content')?.parentElement?.className ?? '');
}

describe('экран ИИ на телефоне не выше окна', () => {
  it('корень оболочки: высота 100dvh без минимума 100vh', () => {
    layout.mode = 'mobile';
    render(
      <MemoryRouter initialEntries={['/ai']}>
        <AppShell />
      </MemoryRouter>,
    );
    const cls = rootClasses();
    expect(cls).toContain('h-[100dvh]');
    expect(cls).not.toMatch(/(^|\s)min-h-screen(\s|$)/);
  });
});
