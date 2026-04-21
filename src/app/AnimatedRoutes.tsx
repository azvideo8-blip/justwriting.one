import React, { useEffect as _ } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import { useAuthStatus } from '../features/auth/hooks/useAuthStatus';
import { useWritingSettings } from '../features/writing/contexts/WritingSettingsContext';
import { useLayoutMode } from '../shared/hooks/useLayoutMode';
import { useLanguage } from '../core/i18n';
import { cn } from '../core/utils/utils';

import { AppLayout } from '../shared/components/Layout/AppLayout';
import { PageTransition } from '../shared/components/Layout/PageTransition';
import { Sidebar } from '../features/navigation/components/Sidebar';
import { BottomNav } from '../features/navigation/components/BottomNav';
// LEGACY: ClassicNavBar — kept for reference
// import { ClassicNavBar } from '../features/navigation/components/ClassicNavBar';
import { ConnectionStatusBanner } from '../features/writing/components/ConnectionStatusBanner';
import { ThemeBackground } from '../core/theme/ThemeBackground';

import { WritingPage } from '../features/writing/pages/WritingPage';
import { MobileLogPage } from '../features/writing/pages/MobileLogPage';
import { MobileMePage } from '../features/writing/pages/MobileMePage';
import { ProfilePage } from '../features/profile/pages/ProfilePage';
import { ArchivePage } from '../features/archive/pages/ArchivePage';
import { FeedPage } from '../features/feed/pages/FeedPage';
import { AdminPage } from '../features/admin/pages/AdminPage';
import { ProtectedRoute } from './ProtectedRoute';

export function AnimatedRoutes() {
  const location = useLocation();
  const { t } = useLanguage();
  const { user, profile, isConnected } = useAuthStatus();
  const { isZenActive, zenModeEnabled, setLifeLogVisible, lifeLogEnabled } = useWritingSettings();
  const { layoutMode, setLayoutMode } = useLayoutMode();
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

  if (!user) return null;

  const currentPath = location.pathname;
  const showZen = isZenActive && zenModeEnabled && currentPath === '/';
  const hideSidebar = lifeLogEnabled && currentPath === '/';
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
            <Sidebar isAdmin={isAdmin} inGrid={false} />
          ) : (
            <BottomNav 
              isAdmin={isAdmin}
            />
          )
        )}
        <ConnectionStatusBanner isOnline={isConnected} showZen={showZen} />
      </>

      <main id="main-content" className={cn(
        "w-full relative z-10",
        hideSidebar ? "" : "pt-8",
        layoutMode === 'desktop' && !hideSidebar && "pl-20 pr-4",
        layoutMode !== 'desktop' && !hideSidebar && "pb-20 px-4"
      )}>
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            <Route path="/" element={
              <PageTransition id="/">
                <WritingPage
                  user={user}
                  profile={profile}
                />
              </PageTransition>
            } />
            <Route path="/log" element={
              <PageTransition id="/log">
                <MobileLogPage />
              </PageTransition>
            } />
            <Route path="/me" element={
              <PageTransition id="/me">
                <MobileMePage />
              </PageTransition>
            } />
            <Route path="/archive" element={
              <PageTransition id="/archive">
                <ArchivePage
                  user={user}
                  profile={profile}
                />
              </PageTransition>
            } />
            <Route path="/profile" element={
              <PageTransition id="/profile">
                <ProfilePage user={user} profile={profile} />
              </PageTransition>
            } />
            <Route path="/feed" element={
              <PageTransition id="/feed">
                <FeedPage />
              </PageTransition>
            } />
            <Route path="/admin" element={
              <ProtectedRoute>
                <PageTransition id="/admin">
                  <AdminPage />
                </PageTransition>
              </ProtectedRoute>
            } />
          </Routes>
        </AnimatePresence>
      </main>

      {layoutMode === 'mobile' && <div className="h-28" />}
    </AppLayout>
  );
}
