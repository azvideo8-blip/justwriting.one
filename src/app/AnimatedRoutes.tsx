import React, { Suspense } from 'react';
import { Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { useAuthStatus } from '../features/auth/hooks/useAuthStatus';
import { useWritingSettings } from '../features/writing/contexts/WritingSettingsContext';
import { useLayoutMode } from '../shared/hooks/useLayoutMode';
import { useLanguage } from '../core/i18n';
import { cn } from '../core/utils/utils';
import { useLoginModal } from '../features/auth/contexts/LoginModalContext';
import { useSettings } from '../core/settings/SettingsContext';

import { AppLayout } from '../shared/components/Layout/AppLayout';
import { Sidebar } from '../features/navigation/components/Sidebar';
import { BottomNav } from '../features/navigation/components/BottomNav';
import { ConnectionStatusBanner } from '../features/writing/components/ConnectionStatusBanner';
import { ThemeBackground } from '../core/theme/ThemeBackground';

import { ProtectedRoute, GuestRoute } from './ProtectedRoute';
import { LoginModalOverlay } from '../features/auth/components/LoginModalOverlay';

const WritingPage = React.lazy(() => import('../features/writing/pages/WritingPage').then(m => ({ default: m.WritingPage })));
const MobileLogPage = React.lazy(() => import('../features/writing/pages/MobileLogPage').then(m => ({ default: m.MobileLogPage })));
const MobileMePage = React.lazy(() => import('../features/writing/pages/MobileMePage').then(m => ({ default: m.MobileMePage })));
const ArchivePage = React.lazy(() => import('../features/archive/pages/ArchivePage').then(m => ({ default: m.ArchivePage })));
const ProfilePage = React.lazy(() => import('../features/profile/pages/ProfilePage').then(m => ({ default: m.ProfilePage })));
const AdminPage = React.lazy(() => import('../features/admin/pages/AdminPage').then(m => ({ default: m.AdminPage })));
const LoginPage = React.lazy(() => import('../features/auth/pages/LoginPage').then(m => ({ default: m.LoginPage })));
const AboutPage = React.lazy(() => import('../features/navigation/pages/AboutPage').then(m => ({ default: m.AboutPage })));

function PageLoader() {
  return <div className="flex items-center justify-center h-full"><div className="text-text-main/30 text-sm">...</div></div>;
}

export function AnimatedRoutes() {
  const location = useLocation();
  const { t } = useLanguage();
  const { user, profile } = useAuthStatus();
  const { isZenActive, zenModeEnabled, lifeLogEnabled } = useWritingSettings();
  const { layoutMode, setLayoutMode } = useLayoutMode();
  const { loginModalOpen } = useLoginModal();
  const { openSettings } = useSettings();
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
            <Sidebar isAdmin={isAdmin} onOpenSettings={openSettings} />
          ) : (
            <BottomNav isAdmin={isAdmin} />
          )
        )}
        <ConnectionStatusBanner showZen={showZen} />
      </>

      <main id="main-content" className={cn(
        "w-full relative z-10 min-h-screen",
        hideSidebar ? "" : "pt-8",
        layoutMode === 'desktop' && !hideSidebar && "pl-20 pr-4",
        layoutMode !== 'desktop' && !hideSidebar && "pb-20 px-4"
      )}>
        <Suspense fallback={<PageLoader />}>
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
        </Suspense>
      </main>

      {layoutMode === 'mobile' && <div className="h-28" />}

      <LoginModalOverlay open={loginModalOpen} />
    </AppLayout>
  );
}
