import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { WifiOff } from 'lucide-react';
import { useLanguage } from '../core/i18n';
import { cn } from '../core/utils/utils';
import { useAuthStatus } from '../features/auth/hooks/useAuthStatus';
import { useLocalStorage } from '../shared/hooks/useLocalStorage';
import { useLayoutMode } from '../shared/hooks/useLayoutMode';
import { z } from 'zod';

// Components
import { AppLayout } from '../shared/components/Layout/AppLayout';
import { PageTransition } from '../shared/components/Layout/PageTransition';
import { BetaSidebar } from '../features/navigation/components/BetaSidebar';
import { BetaBottomNav } from '../features/navigation/components/BetaBottomNav';
import { ClassicNavBar } from '../features/navigation/components/ClassicNavBar';

import { ThemeBackground } from '../core/theme/ThemeBackground';

// Views
import { LoginPage } from '../features/auth/pages/LoginPage';
import { WritingPage } from '../features/writing/pages/WritingPage';
import { ProfilePage } from '../features/profile/pages/ProfilePage';
import { ArchivePage } from '../features/archive/pages/ArchivePage';
import { FeedPage } from '../features/feed/pages/FeedPage';
import { AdminPage } from '../features/admin/pages/AdminPage';
import { useWritingSettings } from '../features/writing/contexts/WritingSettingsContext';
import { Session } from '../types';

export function AppRouter() {
  const { t } = useLanguage();
  const { user, profile, loading, isConnected } = useAuthStatus();
  const [view, setView] = useState<'write' | 'profile' | 'archive' | 'feed' | 'admin'>('write');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sessionToContinue, setSessionToContinue] = useState<Session | null>(null);
  const { isZenActive, zenModeEnabled } = useWritingSettings();
  const showZen = isZenActive && zenModeEnabled && view === 'write';
  
  const isAdmin = profile?.role === 'admin';
  const [classicNav] = useLocalStorage('classic-nav', false, z.boolean());
  const { layoutMode } = useLayoutMode();

  if (loading) return (
    <div className="h-screen w-screen flex items-center justify-center bg-surface-base">
      <motion.div 
        animate={{ scale: [1, 1.1, 1] }} 
        transition={{ repeat: Infinity, duration: 2 }}
        className="text-text-main/40 text-2xl"
      >
        justwriting.one...
      </motion.div>
    </div>
  );

  if (!user) return <LoginPage />;

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
            <BetaSidebar view={view} setView={setView} isAdmin={isAdmin} user={user} isZenActive={showZen} />
          ) : (
            <BetaBottomNav view={view} setView={setView} isAdmin={isAdmin} user={user} />
          )}
          
          {!isConnected && (
            <div className="fixed top-0 left-0 right-0 z-[60] bg-red-500 text-white text-[11px] font-bold py-1 px-4 flex items-center justify-center gap-2 animate-pulse">
              <WifiOff size={12} />
              {t('common_offline')}
            </div>
          )}
        </>
      ) : (
        <ClassicNavBar 
          showZen={showZen}
          isConnected={isConnected}
          mobileMenuOpen={mobileMenuOpen}
          setMobileMenuOpen={setMobileMenuOpen}
          view={view}
          setView={setView}
          isAdmin={isAdmin}
          user={user}
        />
      )}

      {/* Main Content */}
      <main id="main-content" className={cn(
        "w-full relative z-10",
        !classicNav && layoutMode === 'desktop' ? "pl-20 pt-8 pr-4" : "pt-8 px-4",
        classicNav && "pt-24 px-4"
      )}>
        <AnimatePresence mode="wait">
          {view === 'write' && (
            <PageTransition id="write">
              <WritingPage 
                user={user} 
                profile={profile} 
                sessionToContinue={sessionToContinue}
                onSessionContinued={() => setSessionToContinue(null)}
              />
            </PageTransition>
          )}
          {view === 'archive' && (
            <PageTransition id="archive">
              <ArchivePage 
                user={user} 
                profile={profile}
                onContinueSession={(session) => {
                  setSessionToContinue(session);
                  setView('write');
                }}
              />
            </PageTransition>
          )}
          {view === 'profile' && (
            <PageTransition id="profile">
              <ProfilePage user={user} profile={profile} />
            </PageTransition>
          )}
          {view === 'feed' && (
            <PageTransition id="feed">
              <FeedPage />
            </PageTransition>
          )}
          {view === 'admin' && isAdmin && (
            <PageTransition id="admin">
              <AdminPage />
            </PageTransition>
          )}
        </AnimatePresence>
      </main>
      
      {/* Bottom nav padding on mobile in beta mode */}
      {!classicNav && layoutMode === 'mobile' && <div className="h-28" />}
    </AppLayout>
  );
}
