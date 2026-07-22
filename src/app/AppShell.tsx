import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStatus } from '../features/auth/hooks/useAuthStatus';
import { useWritingSettings } from '../features/writing/contexts/WritingSettingsContext';
import { useLayoutMode } from '../shared/hooks/useLayoutMode';
import { useLanguage } from '../shared/i18n';
import { cn } from '../core/utils/utils';
import { useLoginModal } from '../features/auth/contexts/LoginModalContext';
import { useSyncStatus } from '../features/settings/hooks/useSyncStatus';

import { AppLayout } from '../shared/components/Layout/AppLayout';
import { Sidebar } from '../features/navigation/components/Sidebar';
import { BottomNav } from '../features/navigation/components/BottomNav';
import { ConnectionStatusBanner } from '../features/writing/components/ConnectionStatusBanner';
import { ThemeBackground } from '../core/theme/ThemeBackground';
import { LoginModalOverlay } from '../features/auth/components/LoginModalOverlay';
import { useSettings } from '../core/settings/SettingsContext';
import { EncryptionPasswordModal } from '../features/encryption/components/EncryptionPasswordModal';
import { useEncryptionSetup } from '../features/encryption/hooks/useEncryptionSetup';
import { setupGlobalErrorListeners } from '../shared/errors/reportError';
import { ErrorLogBadge } from './ErrorLogBadge';

import { AppRoutes } from './AppRoutes';
import { ConfirmDialogRenderer } from '../shared/components/ConfirmDialog';

export function AppShell() {
  const location = useLocation();
  const { t } = useLanguage();
  const { profile, user, isGuest } = useAuthStatus();
  const { isZenActive, zenModeEnabled, silenceMode } = useWritingSettings();
  const { layoutMode } = useLayoutMode();
  const { loginModalOpen } = useLoginModal();
  const { openSettings } = useSettings();
  const { mode: encryptionMode, check: recheckEncryption } = useEncryptionSetup();

  useSyncStatus(isGuest ? null : (user?.uid ?? null));

  useEffect(() => {
    setupGlobalErrorListeners();
  }, []);

  const currentPath = location.pathname;
  const showZen = isZenActive && zenModeEnabled && currentPath === '/';
  const isAdmin = profile?.role === 'admin';
  // The AI chat manages its own full-height layout; on desktop it must fill the
  // viewport edge-to-edge (only clearing the fixed nav rail) instead of inheriting
  // the padded, scrolling <main> used by the other pages.
  const isChatPageDesktop = currentPath === '/ai' && layoutMode === 'desktop';

  return (
    <AppLayout className="min-h-screen bg-surface-base text-text-main font-sans selection:bg-white/10">
      <a
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          const textarea = document.querySelector<HTMLTextAreaElement>('#main-content textarea');
          if (textarea) { textarea.focus(); } else { document.getElementById('main-content')?.focus(); }
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[var(--z-skip)] focus:px-4 focus:py-2 focus:bg-surface-card focus:text-text-main focus:rounded-xl focus:border focus:border-border-subtle"
      >
        {t('skip_to_content')}
      </a>
      <ThemeBackground silenceMode={silenceMode} />

      <>
        {layoutMode === 'desktop' ? (
          <Sidebar isAdmin={isAdmin} onOpenSettings={openSettings} />
        ) : (
          !showZen && <BottomNav isAdmin={isAdmin} />
        )}
        <ConnectionStatusBanner showZen={showZen} />
      </>

      <main id="main-content" tabIndex={-1} className={cn(
        "w-full relative z-10",
        isChatPageDesktop
          ? "h-screen overflow-hidden pl-16"
          : cn(
              "min-h-screen pt-8",
              layoutMode === 'desktop' && "pl-20 pr-4",
              layoutMode !== 'desktop' && (showZen ? "pb-4 px-4" : "pb-20 px-4")
            )
      )}>
        <AppRoutes />
      </main>

      {/* [U-03] спейсер h-28 убран: pb-20 на main уже компенсирует высоту BottomNav */}
      <LoginModalOverlay open={loginModalOpen} />
      <ConfirmDialogRenderer />
      <ErrorLogBadge />
      {encryptionMode !== 'none' && user && (
        <EncryptionPasswordModal
          mode={encryptionMode}
          userId={user.uid}
          onDone={() => void recheckEncryption()}
        />
      )}
    </AppLayout>
  );
}
