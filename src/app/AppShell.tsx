import { useLocation } from 'react-router-dom';
import { useAuthStatus } from '../features/auth/hooks/useAuthStatus';
import { useWritingSettings } from '../features/writing/contexts/WritingSettingsContext';
import { useLayoutMode } from '../shared/hooks/useLayoutMode';
import { useLanguage } from '../core/i18n';
import { cn } from '../core/utils/utils';
import { useLoginModal } from '../features/auth/contexts/LoginModalContext';

import { AppLayout } from '../shared/components/Layout/AppLayout';
import { Sidebar } from '../features/navigation/components/Sidebar';
import { BottomNav } from '../features/navigation/components/BottomNav';
import { ConnectionStatusBanner } from '../features/writing/components/ConnectionStatusBanner';
import { ThemeBackground } from '../core/theme/ThemeBackground';
import { LoginModalOverlay } from '../features/auth/components/LoginModalOverlay';

import { AppRoutes } from './AppRoutes';

export function AppShell() {
  const location = useLocation();
  const { t } = useLanguage();
  const { profile } = useAuthStatus();
  const { isZenActive, zenModeEnabled, lifeLogEnabled } = useWritingSettings();
  const { layoutMode } = useLayoutMode();
  const { loginModalOpen } = useLoginModal();

  const currentPath = location.pathname;
  const showZen = isZenActive && zenModeEnabled && currentPath === '/';
  const hideSidebar = lifeLogEnabled && currentPath === '/' && layoutMode === 'desktop';
  const isAdmin = profile?.role === 'admin';

  return (
    <AppLayout className="min-h-screen bg-surface-base text-text-main font-sans selection:bg-white/10">
      <a
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          const textarea = document.querySelector<HTMLTextAreaElement>('#main-content textarea');
          if (textarea) { textarea.focus(); } else { document.getElementById('main-content')?.focus(); }
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[999] focus:px-4 focus:py-2 focus:bg-surface-card focus:text-text-main focus:rounded-xl focus:border focus:border-border-subtle"
      >
        {t('skip_to_content')}
      </a>
      <ThemeBackground />

      <>
        {!hideSidebar && (
          layoutMode === 'desktop' ? (
            <Sidebar isAdmin={isAdmin} />
          ) : (
            !showZen && <BottomNav isAdmin={isAdmin} />
          )
        )}
        {layoutMode === 'desktop' && <ConnectionStatusBanner showZen={showZen} />}
      </>

      <main id="main-content" className={cn(
        "w-full relative z-10 min-h-screen",
        hideSidebar ? "" : "pt-8",
        layoutMode === 'desktop' && !hideSidebar && "pl-20 pr-4",
        layoutMode !== 'desktop' && !hideSidebar && (showZen ? "pb-4 px-4" : "pb-20 px-4")
      )}>
        <AppRoutes />
      </main>

      {/* [U-03] спейсер h-28 убран: pb-20 на main уже компенсирует высоту BottomNav */}
      <LoginModalOverlay open={loginModalOpen} />
    </AppLayout>
  );
}
