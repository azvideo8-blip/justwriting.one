import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Menu, WifiOff } from 'lucide-react';
import { useLanguage } from '../core/i18n';
import { cn } from '../core/utils/utils';
import { NAV_CONFIG } from '../shared/lib/layoutRegistry';
import { useAuthStatus } from '../features/auth/hooks/useAuthStatus';
import { useLocalStorage } from '../shared/hooks/useLocalStorage';
import { useLayoutMode } from '../shared/hooks/useLayoutMode';
import { z } from 'zod';

// Components
import { AppLayout } from '../shared/components/Layout/AppLayout';
import { DesktopNav } from '../features/navigation/components/DesktopNav';
import { MobileMenu } from '../features/navigation/components/MobileMenu';
import { BetaSidebar } from '../features/navigation/components/BetaSidebar';
import { BetaBottomNav } from '../features/navigation/components/BetaBottomNav';
import { SettingsPanel } from '../features/settings/components/SettingsPanel';
import { SettingsContext } from '../core/settings/SettingsContext';

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
  const [settingsOpen, setSettingsOpen] = useState(false);
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
    <SettingsContext.Provider value={{ openSettings: () => setSettingsOpen(true) }}>
      <AppLayout className="min-h-screen bg-surface-base text-text-main font-sans selection:bg-white/10">
        <ThemeBackground />
        
        {!classicNav ? (
          <>
            {layoutMode === 'desktop' ? (
              <BetaSidebar view={view} setView={setView} isAdmin={isAdmin} user={user} isZenActive={showZen} />
            ) : (
              <BetaBottomNav view={view} setView={setView} isAdmin={isAdmin} user={user} />
            )}
            
            {!isConnected && (
              <div className="fixed top-0 left-0 right-0 z-[60] bg-red-500 text-white text-[10px] font-bold py-1 px-4 flex items-center justify-center gap-2 animate-pulse">
                <WifiOff size={12} />
                {t('common_offline')}
              </div>
            )}
          </>
        ) : (
          <>
            {/* Original navigation */}
            <nav className={cn(
              "fixed top-0 left-0 right-0 h-16 z-50 px-4 md:px-6 flex items-center justify-between transition-all duration-1000 bg-surface-base/50 backdrop-blur-xl border-b border-border-subtle",
              showZen ? "opacity-0 pointer-events-none -translate-y-4" : "opacity-100 translate-y-0"
            )}>
              {!isConnected && (
                <div className="absolute top-16 left-0 right-0 bg-red-500 text-white text-[10px] font-bold py-1 px-4 flex items-center justify-center gap-2 animate-pulse">
                  <WifiOff size={12} />
                  {t('common_offline')}
                </div>
              )}
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setMobileMenuOpen(true)}
                  className={cn("p-2 -ml-2 text-text-main/50 hover:text-text-main", NAV_CONFIG.MOBILE_BREAKPOINT_CLASS)}
                >
                  <Menu size={24} />
                </button>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xl font-black bg-text-main text-surface-base shadow-[0_0_15px_rgba(255,255,255,0.2)]">J</div>
                <span className="font-bold text-xl tracking-tight hidden lg:inline text-text-main">justwriting.one</span>
              </div>
              
              <div className={NAV_CONFIG.DESKTOP_SHOW_CLASS}>
                <DesktopNav view={view} setView={setView} isAdmin={isAdmin} user={user} />
              </div>

              {/* Mobile Header Actions */}
              <div className="flex lg:hidden items-center gap-2">
                <img src={user.photoURL || undefined} className="w-8 h-8 rounded-full border border-border-subtle" referrerPolicy="no-referrer" />
              </div>
            </nav>

            <MobileMenu 
              isOpen={mobileMenuOpen} 
              onClose={() => setMobileMenuOpen(false)} 
              view={view} 
              setView={setView} 
              isAdmin={isAdmin} 
            />
          </>
        )}

        {/* Main Content */}
        <main className={cn(
          "w-full relative z-10",
          !classicNav && layoutMode === 'desktop' ? "pl-20 pt-8 pr-4" : "pt-8 px-4",
          classicNav && "pt-24 px-4"
        )}>
          <AnimatePresence mode="wait">
            {view === 'write' && (
              <WritingPage 
                key="write" 
                user={user} 
                profile={profile} 
                sessionToContinue={sessionToContinue}
                onSessionContinued={() => setSessionToContinue(null)}
              />
            )}
            {view === 'archive' && (
              <ArchivePage 
                key="archive" 
                user={user} 
                profile={profile}
                onContinueSession={(session) => {
                  setSessionToContinue(session);
                  setView('write');
                }}
              />
            )}
            {view === 'profile' && <ProfilePage key="profile" user={user} profile={profile} />}
            {view === 'feed' && <FeedPage key="feed" />}
            {view === 'admin' && isAdmin && <AdminPage key="admin" />}
          </AnimatePresence>
        </main>
        
        {/* Bottom nav padding on mobile in beta mode */}
        {!classicNav && layoutMode === 'mobile' && <div className="h-20" />}
        
        <SettingsPanel
          isOpen={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          userId={user.uid}
        />
      </AppLayout>
    </SettingsContext.Provider>
  );
}
