import { Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import { useAuthStatus } from '../features/auth/hooks/useAuthStatus';
import { useWritingSettings } from '../features/writing/contexts/WritingSettingsContext';
import { useLocalStorage } from '../shared/hooks/useLocalStorage';
import { useLayoutMode } from '../shared/hooks/useLayoutMode';
import { useLanguage } from '../core/i18n';
import { cn } from '../core/utils/utils';
import { z } from 'zod';

import { AppLayout } from '../shared/components/Layout/AppLayout';
import { PageTransition } from '../shared/components/Layout/PageTransition';
import { BetaSidebar } from '../features/navigation/components/BetaSidebar';
import { BetaBottomNav } from '../features/navigation/components/BetaBottomNav';
import { ClassicNavBar } from '../features/navigation/components/ClassicNavBar';
import { ConnectionStatusBanner } from '../features/writing/components/ConnectionStatusBanner';
import { ThemeBackground } from '../core/theme/ThemeBackground';

import { WritingPage } from '../features/writing/pages/WritingPage';
import { ProfilePage } from '../features/profile/pages/ProfilePage';
import { ArchivePage } from '../features/archive/pages/ArchivePage';
import { FeedPage } from '../features/feed/pages/FeedPage';
import { AdminPage } from '../features/admin/pages/AdminPage';
import { ProtectedRoute } from './ProtectedRoute';

export function AnimatedRoutes() {
  const location = useLocation();
  const { t } = useLanguage();
  const { user, profile, isConnected } = useAuthStatus();
  const { isZenActive, zenModeEnabled, setLifeLogVisible } = useWritingSettings();
  const [classicNav] = useLocalStorage('classic-nav', false, z.boolean());
  const { layoutMode } = useLayoutMode();

  if (!user) return null;

  const currentPath = location.pathname;
  const showZen = isZenActive && zenModeEnabled && currentPath === '/';
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

      {!classicNav ? (
        <>
          {layoutMode === 'desktop' ? (
            <BetaSidebar isAdmin={isAdmin} />
          ) : (
            <BetaBottomNav 
              isAdmin={isAdmin} 
              user={user}
              onOpenLifeLog={() => setLifeLogVisible(true)}
            />
          )}
          <ConnectionStatusBanner isOnline={isConnected} showZen={showZen} />
        </>
      ) : (
        <ClassicNavBar showZen={showZen} />
      )}

      <main id="main-content" className={cn(
        "w-full relative z-10 pt-8",
        !classicNav && layoutMode === 'desktop' && "pl-20 pr-4",
        !classicNav && layoutMode !== 'desktop' && "px-4",
        classicNav && "pt-24 px-4"
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

      {!classicNav && layoutMode === 'mobile' && <div className="h-28" />}
    </AppLayout>
  );
}
