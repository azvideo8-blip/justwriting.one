import { useState, useEffect } from 'react';
import { auth, db, signOut, onConnectionChange } from './lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { motion, AnimatePresence } from 'motion/react';
import { 
  PenLine, 
  History, 
  Globe, 
  Menu,
  X, 
  LogOut, 
  User as UserIcon,
  Sun,
  Moon,
  WifiOff,
  Shield
} from 'lucide-react';
import { onSnapshot, doc, setDoc } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from './lib/firestore-errors';
import { ErrorBoundary } from './components/ErrorBoundary';

// Components
import { NavButton } from './components/NavButton';
import { MobileNavButton } from './components/MobileNavButton';

// Views
import { LoginView } from './views/LoginView';
import { WritingView } from './views/WritingView';
import { ProfileView } from './views/ProfileView';
import { ArchiveView } from './views/ArchiveView';
import { FeedView } from './views/FeedView';
import { AdminView } from './views/AdminView';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<{ nickname?: string; role?: string } | null>(null);
  const [view, setView] = useState<'write' | 'profile' | 'archive' | 'feed' | 'admin'>('write');
  const [loading, setLoading] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  
  const isAdmin = profile?.role === 'admin' || user?.email === 'freudcries@gmail.com';
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') === 'dark';
    }
    return false;
  });

  useEffect(() => {
    return onConnectionChange(setIsConnected);
  }, []);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [darkMode]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        const userDoc = doc(db, 'users', u.uid);
        onSnapshot(userDoc, (snap) => {
          if (snap.exists()) {
            setProfile(snap.data() as { nickname?: string });
          } else {
            const initialProfile = { 
              uid: u.uid,
              email: u.email || '',
              nickname: u.email?.split('@')[0] || 'User',
              role: 'user'
            };
            setDoc(userDoc, initialProfile).catch(err => {
              handleFirestoreError(err, OperationType.WRITE, `users/${u.uid}`);
            });
            setProfile(initialProfile);
          }
          setLoading(false);
        }, (err) => {
          handleFirestoreError(err, OperationType.GET, `users/${u.uid}`);
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

  if (!user) return <LoginView />;

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 font-sans selection:bg-stone-200 dark:selection:bg-stone-800">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 h-16 bg-white/80 dark:bg-stone-900/80 backdrop-blur-md border-b border-stone-200 dark:border-stone-800 z-50 px-4 md:px-6 flex items-center justify-between">
        {!isConnected && (
          <div className="absolute top-16 left-0 right-0 bg-red-500 text-white text-[10px] font-bold py-1 px-4 flex items-center justify-center gap-2 animate-pulse">
            <WifiOff size={12} />
            НЕТ СВЯЗИ С БАЗОЙ ДАННЫХ. ПРОВЕРЬТЕ ИНТЕРНЕТ.
          </div>
        )}
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setMobileMenuOpen(true)}
            className="p-2 -ml-2 text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100 md:hidden"
          >
            <Menu size={24} />
          </button>
          <div className="w-8 h-8 bg-stone-900 dark:bg-stone-100 rounded-lg flex items-center justify-center text-white dark:text-stone-900 font-bold text-xl">J</div>
          <span className="font-bold text-xl tracking-tight hidden sm:inline">justwriting.one</span>
        </div>
        
        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center gap-6">
          <NavButton active={view === 'write'} onClick={() => setView('write')} icon={<PenLine size={18} />} label="Писать" />
          <NavButton active={view === 'archive'} onClick={() => setView('archive')} icon={<History size={18} />} label="Архив" />
          <NavButton active={view === 'profile'} onClick={() => setView('profile')} icon={<UserIcon size={18} />} label="Профиль" />
          <NavButton active={view === 'feed'} onClick={() => setView('feed')} icon={<Globe size={18} />} label="Лента" />
          {isAdmin && (
            <NavButton active={view === 'admin'} onClick={() => setView('admin')} icon={<Shield size={18} className="text-red-500" />} label="Админ" />
          )}
          
          <div className="h-6 w-px bg-stone-200 dark:bg-stone-800 mx-2" />
          
          <button 
            onClick={() => setDarkMode(!darkMode)}
            className="p-2 text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100 transition-colors"
          >
            {darkMode ? <Sun size={20} /> : <Moon size={20} />}
          </button>

          <button 
            onClick={() => signOut(auth)}
            className="flex items-center gap-2 text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100 transition-colors"
            title="Выйти"
          >
            <img src={user.photoURL || ''} className="w-8 h-8 rounded-full border border-stone-200 dark:border-stone-800" referrerPolicy="no-referrer" />
            <LogOut size={18} />
          </button>
        </div>

        {/* Mobile Header Actions */}
        <div className="flex md:hidden items-center gap-2">
          <button 
            onClick={() => setDarkMode(!darkMode)}
            className="p-2 text-stone-500 dark:text-stone-400"
          >
            {darkMode ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          <img src={user.photoURL || ''} className="w-8 h-8 rounded-full border border-stone-200 dark:border-stone-800" referrerPolicy="no-referrer" />
        </div>
      </nav>

      {/* Mobile Sidebar Menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileMenuOpen(false)}
              className="fixed inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-sm z-[60]"
            />
            <motion.div 
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 left-0 bottom-0 w-[280px] bg-white dark:bg-stone-900 z-[70] shadow-2xl border-r border-stone-200 dark:border-stone-800 p-6 flex flex-col"
            >
              <div className="flex items-center justify-between mb-10">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-stone-900 dark:bg-stone-100 rounded-lg flex items-center justify-center text-white dark:text-stone-900 font-bold text-xl">J</div>
                  <span className="font-bold text-xl tracking-tight">justwriting.one</span>
                </div>
                <button 
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-2 text-stone-400 hover:text-stone-900 dark:hover:text-stone-100"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="flex flex-col gap-2 flex-1">
                <MobileNavButton 
                  active={view === 'write'} 
                  onClick={() => { setView('write'); setMobileMenuOpen(false); }} 
                  icon={<PenLine size={20} />} 
                  label="Писать" 
                />
                <MobileNavButton 
                  active={view === 'archive'} 
                  onClick={() => { setView('archive'); setMobileMenuOpen(false); }} 
                  icon={<History size={20} />} 
                  label="Архив" 
                />
                <MobileNavButton 
                  active={view === 'profile'} 
                  onClick={() => { setView('profile'); setMobileMenuOpen(false); }} 
                  icon={<UserIcon size={20} />} 
                  label="Профиль" 
                />
                <MobileNavButton 
                  active={view === 'feed'} 
                  onClick={() => { setView('feed'); setMobileMenuOpen(false); }} 
                  icon={<Globe size={20} />} 
                  label="Лента" 
                />
                {isAdmin && (
                  <MobileNavButton 
                    active={view === 'admin'} 
                    onClick={() => { setView('admin'); setMobileMenuOpen(false); }} 
                    icon={<Shield size={20} className="text-red-500" />} 
                    label="Админ-панель" 
                  />
                )}
              </div>

              <button 
                onClick={() => signOut(auth)}
                className="mt-auto flex items-center gap-3 p-4 text-stone-500 hover:text-red-500 transition-colors font-semibold"
              >
                <LogOut size={20} />
                Выйти
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="pt-24 px-4 md:px-6 max-w-7xl mx-auto">
        <AnimatePresence mode="wait">
          {view === 'write' && <WritingView key="write" user={user} profile={profile} />}
          {view === 'archive' && <ArchiveView key="archive" user={user} />}
          {view === 'profile' && <ProfileView key="profile" user={user} profile={profile} />}
          {view === 'feed' && <FeedView key="feed" />}
          {view === 'admin' && isAdmin && <AdminView key="admin" />}
        </AnimatePresence>
      </main>
      </div>
    </ErrorBoundary>
  );
}
