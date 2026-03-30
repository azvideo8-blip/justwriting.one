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

// Components
import { DesktopNav } from '../features/navigation/components/DesktopNav';
import { MobileMenu } from '../features/navigation/components/MobileMenu';

// Views
import { LoginPage } from '../features/auth/pages/LoginPage';
import { WritingPage } from '../features/writing/pages/WritingPage';
import { ProfilePage } from '../features/profile/pages/ProfilePage';
import { ArchivePage } from '../features/archive/pages/ArchivePage';
import { FeedPage } from '../features/feed/pages/FeedPage';
import { AdminPage } from '../features/admin/pages/AdminPage';
import { Session, UserProfile } from '../types';

export function AppRouter() {
  const { t } = useLanguage();
  const { uiVersion } = useUI();
  const isV2 = uiVersion === '2.0';
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [view, setView] = useState<'write' | 'profile' | 'archive' | 'feed' | 'admin'>('write');
  const [loading, setLoading] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  const [sessionToContinue, setSessionToContinue] = useState<Session | null>(null);
  
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
      if (u) {
        const userDoc = doc(db, 'users', u.uid);
        onSnapshot(userDoc, (snap) => {
          if (snap.exists()) {
            setProfile(snap.data() as UserProfile);
          } else {
            const initialProfile: UserProfile = { 
              uid: u.uid,
              email: u.email || '',
              nickname: u.email?.split('@')[0] || 'User',
              role: 'user'
            };
            setDoc(userDoc, initialProfile).catch(err => {
              console.error('Error creating user profile:', err);
            });
            setProfile(initialProfile);
          }
          setLoading(false);
        }, (err) => {
          console.error('Firestore snapshot error:', err);
          setLoading(false);
        });
      } else {
        setProfile(null);
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

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
    <div className={cn(
      "min-h-screen bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 font-sans selection:bg-stone-200 dark:selection:bg-stone-800",
      isV2 && "theme-v2"
    )}>
      {/* Navigation */}
      <nav className={cn(
        "fixed top-0 left-0 right-0 h-16 z-50 px-4 md:px-6 flex items-center justify-between transition-all duration-300",
        isV2 
          ? "bg-[#0A0A0B]/50 backdrop-blur-xl border-b border-white/5" 
          : "bg-white/80 dark:bg-stone-900/80 backdrop-blur-md border-b border-stone-200 dark:border-stone-800"
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
            className="p-2 -ml-2 text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100 md:hidden"
          >
            <Menu size={24} />
          </button>
          <div className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center text-xl",
            isV2 ? "bg-white text-black font-black shadow-[0_0_15px_rgba(255,255,255,0.2)]" : "font-bold bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900"
          )}>J</div>
          <span className={cn("font-bold text-xl tracking-tight hidden sm:inline", isV2 && "text-white")}>justwriting.one</span>
        </div>
        
        <DesktopNav view={view} setView={setView} isAdmin={isAdmin} user={user} />

        {/* Mobile Header Actions */}
        <div className="flex md:hidden items-center gap-2">
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
      <main className="pt-24 px-4 md:px-6 max-w-7xl mx-auto">
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
    </div>
  );
}
