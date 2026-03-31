import { useState, useEffect } from 'react';
import { auth } from '../core/firebase/auth';
import { db, onConnectionChange } from '../core/firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { motion, AnimatePresence } from 'motion/react';
import { Menu, WifiOff } from 'lucide-react';
import { onSnapshot, doc, setDoc } from 'firebase/firestore';
import { useLanguage } from '../core/i18n';
import { useUI } from '../contexts/UIContext';
import { cn } from '../core/utils/utils';
import { NAV_CONFIG } from '../shared/lib/layoutRegistry';

// Components
import { AppLayout } from '../shared/components/Layout/AppLayout';
import { DesktopNav } from '../features/navigation/components/DesktopNav';
import { MobileMenu } from '../features/navigation/components/MobileMenu';

// Views
import { LoginPage } from '../features/auth/pages/LoginPage';
import { WritingPage } from '../features/writing/pages/WritingPage';
import { ProfilePage } from '../features/profile/pages/ProfilePage';
import { ArchivePage } from '../features/archive/pages/ArchivePage';
import { FeedPage } from '../features/feed/pages/FeedPage';
import { AdminPage } from '../features/admin/pages/AdminPage';
import { useWritingSettings } from '../features/writing/contexts/WritingSettingsContext';
import { Session, UserProfile } from '../types';

export function AppRouter() {
  const { t } = useLanguage();
  const { uiVersion } = useUI();
  const isV2 = uiVersion === '2.0';
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [creationAttempted, setCreationAttempted] = useState(false);
  const [view, setView] = useState<'write' | 'profile' | 'archive' | 'feed' | 'admin'>('write');
  const [loading, setLoading] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  const [sessionToContinue, setSessionToContinue] = useState<Session | null>(null);
  const { isZenActive, zenModeEnabled } = useWritingSettings();
  const showZen = isZenActive && zenModeEnabled && view === 'write';
  
  const isAdmin = profile?.role === 'admin';

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('dark');
    root.style.colorScheme = 'dark';
  }, []);

  useEffect(() => {
    return onConnectionChange(setIsConnected);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }

    const userDoc = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userDoc, (snap) => {
      if (snap.exists()) {
        setProfile(snap.data() as UserProfile);
      } else {
        if (creationAttempted) return;
        setCreationAttempted(true);
        const initialProfile: UserProfile = { 
          uid: user.uid,
          email: user.email || '',
          nickname: user.displayName || user.email?.split('@')[0] || 'User',
          role: 'user'
        };
        
        console.log('Creating initial user profile:', JSON.stringify(initialProfile));
        
        setDoc(userDoc, initialProfile).catch(err => {
          console.error('Error creating user profile:', err);
          if (err.code === 'permission-denied') {
            console.error('Permission denied. Check firestore.rules and the profile data structure.');
          }
        });
        setProfile(initialProfile);
      }
    }, (err) => {
      console.error('Firestore snapshot error:', err);
      if (err.code === 'permission-denied') {
        console.error('Permission denied for user document:', user.uid);
      }
    });

    return unsubscribe;
  }, [user, creationAttempted]);

  if (loading) return (
    <div className="h-screen w-screen flex items-center justify-center bg-stone-50 dark:bg-stone-950">
      <motion.div 
        animate={{ scale: [1, 1.1, 1] }} 
        transition={{ repeat: Infinity, duration: 2 }}
        className="text-stone-400 text-2xl"
      >
        justwriting.one...
      </motion.div>
    </div>
  );

  if (!user) return <LoginPage />;

  return (
    <AppLayout className={cn(
      "min-h-screen bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 font-sans selection:bg-stone-200 dark:selection:bg-stone-800",
      isV2 && "theme-v2"
    )}>
      {/* Navigation */}
      <nav className={cn(
        "fixed top-0 left-0 right-0 h-16 z-50 px-4 md:px-6 flex items-center justify-between transition-all duration-1000",
        isV2 
          ? "bg-[#0A0A0B]/50 backdrop-blur-xl border-b border-white/5" 
          : "bg-white/80 dark:bg-stone-900/80 backdrop-blur-md border-b border-stone-200 dark:border-stone-800",
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
            className={cn("p-2 -ml-2 text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100", NAV_CONFIG.MOBILE_BREAKPOINT_CLASS)}
          >
            <Menu size={24} />
          </button>
          <div className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center text-xl font-bold bg-white text-stone-900 border border-stone-200 shadow-sm",
            isV2 && "font-black shadow-[0_0_15px_rgba(255,255,255,0.2)]"
          )}>J</div>
          <span className={cn("font-bold text-xl tracking-tight hidden lg:inline text-stone-900 dark:text-white")}>justwriting.one</span>
        </div>
        
        <div className={NAV_CONFIG.DESKTOP_SHOW_CLASS}>
          <DesktopNav view={view} setView={setView} isAdmin={isAdmin} user={user} />
        </div>

        {/* Mobile Header Actions */}
        <div className="flex lg:hidden items-center gap-2">
          <img src={user.photoURL || ''} className="w-8 h-8 rounded-full border border-stone-200 dark:border-stone-800" referrerPolicy="no-referrer" />
        </div>
      </nav>

      <MobileMenu 
        isOpen={mobileMenuOpen} 
        onClose={() => setMobileMenuOpen(false)} 
        view={view} 
        setView={setView} 
        isAdmin={isAdmin} 
      />

      {/* Main Content */}
      <main className="pt-24 w-full">
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
    </AppLayout>
  );
}
