import React from 'react';
import { Routes, Route, useLocation, Navigate } from 'react-router-dom';
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

import { WritingPage } from '../features/writing/pages/WritingPage';
import { MobileLogPage } from '../features/writing/pages/MobileLogPage';
import { MobileMePage } from '../features/writing/pages/MobileMePage';
import { ProfilePage } from '../features/profile/pages/ProfilePage';
import { ArchivePage } from '../features/archive/pages/ArchivePage';
import { AdminPage } from '../features/admin/pages/AdminPage';
import { LoginPage } from '../features/auth/pages/LoginPage';
import { AboutPage } from '../features/navigation/pages/AboutPage';
import { ProtectedRoute, GuestRoute } from './ProtectedRoute';
import { LoginModalOverlay } from '../features/auth/components/LoginModalOverlay';

export function AnimatedRoutes() {
  const location = useLocation();
  const { t } = useLanguage();
  const { user, profile } = useAuthStatus();
  const { isZenActive, zenModeEnabled, lifeLogEnabled } = useWritingSettings();
  const { layoutMode, setLayoutMode } = useLayoutMode();
  const { loginModalOpen } = useLoginModal();
  const layoutModeRef = React.useRef(layoutMode);
  React.useEffect(() => { layoutModeRef.current = layoutMode; }, [layoutMode]);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyM') {
        e.preventDefault();
        setLayoutMode(layoutModeRef.current === 'desktop' ? 'mobile' : 'desktop');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setLayoutMode]);

  const currentPath = location.pathname;
  const showZen = isZenActive && zenModeEnabled && currentPath === '/';
  const hideSidebar = lifeLogEnabled && currentPath === '/' && layoutMode === 'desktop';
  const isAdmin = profile?.role === 'admin';

  return (
    <AppLayout className="min-h-screen bg-surface-base text-text-main font-sans selection:bg-white/10">
      <a
        href="#main-content"
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
            <BottomNav isAdmin={isAdmin} />
          )
        )}
        <ConnectionStatusBanner showZen={showZen} />
      </>

      <main id="main-content" className={cn(
        "w-full relative z-10",
        hideSidebar ? "" : "pt-8",
        layoutMode === 'desktop' && !hideSidebar && "pl-20 pr-4",
        layoutMode !== 'desktop' && !hideSidebar && "pb-20 px-4"
      )}>
        <Routes location={location}>
            <Route path="/" element={<WritingPage user={user} profile={profile} />} />
            <Route path="/log" element={<MobileLogPage />} />
            <Route path="/me" element={<MobileMePage />} />
            <Route path="/archive" element={<ArchivePage user={user} profile={profile} />} />
            <Route path="/profile" element={<ProfilePage user={user} profile={profile} />} />
            <Route path="/admin" element={<ProtectedRoute requireAdmin><AdminPage /></ProtectedRoute>} />
            <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
      </main>

      {layoutMode === 'mobile' && <div className="h-28" />}

      <LoginModalOverlay open={loginModalOpen} />
    </AppLayout>
  );
}
