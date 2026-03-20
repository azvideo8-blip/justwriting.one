import { useState, useEffect } from 'react';
import { auth, db, onConnectionChange } from './lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Menu,
  WifiOff
} from 'lucide-react';
import { onSnapshot, doc, setDoc } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from './lib/firestore-errors';
import { ErrorBoundary } from './components/ErrorBoundary';

// Components
import { DesktopNav } from './components/DesktopNav';
import { MobileMenu } from './components/MobileMenu';

// Views
import { LoginView } from './views/LoginView';
import { WritingView } from './views/WritingView';
import { ProfileView } from './views/ProfileView';
import { ArchiveView } from './views/ArchiveView';
import { FeedView } from './views/FeedView';
import { AdminView } from './views/AdminView';
import { Session } from './types';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<{ nickname?: string; role?: string } | null>(null);
  const [view, setView] = useState<'write' | 'profile' | 'archive' | 'feed' | 'admin'>('write');
  const [loading, setLoading] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  const [sessionToContinue, setSessionToContinue] = useState<Session | null>(null);
  
  const isAdmin = profile?.role === 'admin' || user?.email === 'freudcries@gmail.com';
  
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
              <WritingView 
                key="write" 
                user={user} 
                profile={profile} 
                sessionToContinue={sessionToContinue}
                onSessionContinued={() => setSessionToContinue(null)}
              />
            )}
            {view === 'archive' && (
              <ArchiveView 
                key="archive" 
                user={user} 
                onContinueSession={(session) => {
                  setSessionToContinue(session);
                  setView('write');
                }}
              />
            )}
            {view === 'profile' && <ProfileView key="profile" user={user} profile={profile} />}
            {view === 'feed' && <FeedView key="feed" />}
            {view === 'admin' && isAdmin && <AdminView key="admin" />}
          </AnimatePresence>
        </main>
      </div>
    </ErrorBoundary>
  );
}
