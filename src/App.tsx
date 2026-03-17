import { useState, useEffect, useRef } from 'react';
import { auth, db, googleProvider, signInWithPopup, signOut, collection, addDoc, query, where, orderBy, onSnapshot, limit, setDoc, doc } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { motion, AnimatePresence } from 'motion/react';
import { 
  PenLine, 
  History, 
  Globe, 
  Play, 
  Pause, 
  Square, 
  X, 
  ChevronRight, 
  Calendar as CalendarIcon, 
  Sparkles, 
  LogOut, 
  User as UserIcon,
  Clock,
  Type,
  TrendingUp,
  Share2,
  Lock,
  Sun,
  Moon
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday } from 'date-fns';
import Markdown from 'react-markdown';
import { editWithAI } from './services/geminiService';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface Session {
  id: string;
  userId: string;
  authorName: string;
  authorPhoto: string;
  content: string;
  duration: number;
  wordCount: number;
  wpm: number;
  isPublic: boolean;
  createdAt: any;
  aiEdits?: {
    shortened?: string;
    accents?: string;
    ideas?: string;
  };
}

// --- Components ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<'write' | 'archive' | 'feed'>('write');
  const [loading, setLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') === 'dark';
    }
    return false;
  });

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
      setLoading(false);
      if (u) {
        // Ensure user profile exists in Firestore
        setDoc(doc(db, 'users', u.uid), {
          uid: u.uid,
          email: u.email,
          displayName: u.displayName,
          photoURL: u.photoURL,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      }
    });
    return unsubscribe;
  }, []);

  if (loading) return <div className="h-screen w-screen flex items-center justify-center bg-stone-50 dark:bg-stone-950">
    <motion.div 
      animate={{ scale: [1, 1.1, 1] }} 
      transition={{ repeat: Infinity, duration: 2 }}
      className="text-stone-400 text-2xl"
    >
      JustWrite...
    </motion.div>
  </div>;

  if (!user) return <LoginView />;

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 font-sans selection:bg-stone-200 dark:selection:bg-stone-800">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 h-16 bg-white/80 dark:bg-stone-900/80 backdrop-blur-md border-b border-stone-200 dark:border-stone-800 z-50 px-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-stone-900 dark:bg-stone-100 rounded-lg flex items-center justify-center text-white dark:text-stone-900 font-bold text-xl">J</div>
          <span className="font-bold text-xl tracking-tight">JustWrite.io</span>
        </div>
        
        <div className="flex items-center gap-6">
          <NavButton active={view === 'write'} onClick={() => setView('write')} icon={<PenLine size={18} />} label="Писать" />
          <NavButton active={view === 'archive'} onClick={() => setView('archive')} icon={<History size={18} />} label="Архив" />
          <NavButton active={view === 'feed'} onClick={() => setView('feed')} icon={<Globe size={18} />} label="Лента" />
          
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
      </nav>

      <main className="pt-24 pb-12 max-w-5xl mx-auto px-6">
        <AnimatePresence mode="wait">
          {view === 'write' && <WritingView key="write" user={user} />}
          {view === 'archive' && <ArchiveView key="archive" user={user} />}
          {view === 'feed' && <FeedView key="feed" />}
        </AnimatePresence>
      </main>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-full transition-all duration-300",
        active ? "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 shadow-lg shadow-stone-200 dark:shadow-none" : "text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800"
      )}
    >
      {icon}
      <span className="font-medium text-sm">{label}</span>
    </button>
  );
}

function LoginView() {
  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-stone-50 dark:bg-stone-950 px-6">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full text-center space-y-8"
      >
        <div className="space-y-4">
          <div className="w-16 h-16 bg-stone-900 dark:bg-stone-100 rounded-2xl flex items-center justify-center text-white dark:text-stone-900 font-bold text-4xl mx-auto shadow-2xl">J</div>
          <h1 className="text-5xl font-bold tracking-tight dark:text-stone-100">JustWrite.io</h1>
          <p className="text-stone-500 dark:text-stone-400 text-lg leading-relaxed">
            Минималистичное пространство для писателей. Пишите каждый день, отслеживайте прогресс и делитесь творчеством.
          </p>
        </div>

        <button 
          onClick={() => signInWithPopup(auth, googleProvider)}
          className="w-full flex items-center justify-center gap-3 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 py-4 rounded-xl shadow-sm hover:shadow-md hover:bg-stone-50 dark:hover:bg-stone-800 transition-all group"
        >
          <img src="https://www.google.com/favicon.ico" className="w-5 h-5" />
          <span className="font-semibold text-stone-700 dark:text-stone-200">Войти через Google</span>
          <ChevronRight size={18} className="text-stone-300 group-hover:translate-x-1 transition-transform" />
        </button>

        <p className="text-stone-400 dark:text-stone-500 text-sm">
          Никаких отвлекающих факторов. Только вы и ваши слова.
        </p>
      </motion.div>
    </div>
  );
}

function WritingView({ user }: { user: User }) {
  const [status, setStatus] = useState<'idle' | 'writing' | 'paused' | 'finished'>('idle');
  const [content, setContent] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [wpm, setWpm] = useState(0);
  const [isPublic, setIsPublic] = useState(false);
  const [aiAction, setAiAction] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [loadingAI, setLoadingAI] = useState(false);
  
  const timerRef = useRef<any>(null);

  useEffect(() => {
    if (status === 'writing') {
      timerRef.current = setInterval(() => {
        setSeconds(s => s + 1);
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [status]);

  useEffect(() => {
    const words = content.trim().split(/\s+/).filter(x => x.length > 0).length;
    const minutes = seconds / 60;
    if (minutes > 0) {
      setWpm(Math.round(words / minutes));
    }
  }, [content, seconds]);

  const handleStart = () => setStatus('writing');
  const handlePause = () => setStatus('paused');
  const handleCancel = () => {
    if (confirm("Вы уверены? Весь текущий прогресс будет потерян.")) {
      setStatus('idle');
      setContent('');
      setSeconds(0);
    }
  };

  const handleFinish = async () => {
    setStatus('finished');
    const words = content.trim().split(/\s+/).filter(x => x.length > 0).length;
    
    try {
      await addDoc(collection(db, 'sessions'), {
        userId: user.uid,
        authorName: user.displayName || 'Anonymous',
        authorPhoto: user.photoURL || '',
        content,
        duration: seconds,
        wordCount: words,
        wpm: Math.round(words / (seconds / 60)) || 0,
        isPublic,
        createdAt: new Date().toISOString()
      });
    } catch (e) {
      console.error("Save error:", e);
    }
  };

  const handleAI = async (action: 'shorten' | 'accents' | 'ideas') => {
    setLoadingAI(true);
    setAiAction(action);
    const result = await editWithAI(content, action);
    setAiResult(result);
    setLoadingAI(false);
  };

  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (status === 'finished') {
    return (
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="space-y-8"
      >
        <div className="bg-white dark:bg-stone-900 p-8 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-xl shadow-stone-100 dark:shadow-none space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-3xl font-bold dark:text-stone-100">Сессия завершена</h2>
            <button onClick={() => setStatus('idle')} className="p-2 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-full transition-colors">
              <X size={24} />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <StatCard icon={<Clock size={16} />} label="Время" value={formatTime(seconds)} />
            <StatCard icon={<Type size={16} />} label="Слова" value={content.trim().split(/\s+/).filter(x => x.length > 0).length.toString()} />
            <StatCard icon={<TrendingUp size={16} />} label="Сл/мин" value={wpm.toString()} />
          </div>

          <div className="space-y-4">
            <h3 className="font-medium text-stone-500 dark:text-stone-400 uppercase text-xs tracking-widest">ИИ Инструменты</h3>
            <div className="flex gap-3">
              <AIButton onClick={() => handleAI('shorten')} label="Сократить" icon={<Square size={14} />} active={aiAction === 'shorten'} />
              <AIButton onClick={() => handleAI('accents')} label="Добавить акценты" icon={<Sparkles size={14} />} active={aiAction === 'accents'} />
              <AIButton onClick={() => handleAI('ideas')} label="Придумать идеи" icon={<PenLine size={14} />} active={aiAction === 'ideas'} />
            </div>
          </div>

          {aiResult && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-6 bg-stone-50 dark:bg-stone-950 rounded-2xl border border-stone-200 dark:border-stone-800 prose prose-stone dark:prose-invert max-w-none"
            >
              {loadingAI ? (
                <div className="flex items-center gap-3 text-stone-400 italic">
                  <Sparkles className="animate-pulse" size={18} />
                  Генерация...
                </div>
              ) : (
                <Markdown>{aiResult}</Markdown>
              )}
            </motion.div>
          )}

          <div className="pt-6 border-t border-stone-100 dark:border-stone-800 flex justify-end gap-4">
             <button 
              onClick={() => setStatus('idle')}
              className="px-6 py-3 rounded-xl font-semibold text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors"
            >
              Готово
            </button>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-8"
    >
      {/* Writing Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-8">
          <div className="flex flex-col">
            <span className="text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest">Время</span>
            <span className="text-3xl font-mono font-medium dark:text-stone-100">{formatTime(seconds)}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest">Сл/мин</span>
            <span className="text-3xl font-mono font-medium dark:text-stone-100">{wpm}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {status === 'idle' && (
            <button 
              onClick={handleStart}
              className="flex items-center gap-2 bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 px-6 py-3 rounded-xl font-semibold shadow-lg shadow-stone-200 dark:shadow-none hover:scale-105 transition-all"
            >
              <Play size={18} fill="currentColor" />
              Начать сессию
            </button>
          )}
          {status === 'writing' && (
            <>
              <button 
                onClick={handlePause}
                className="flex items-center gap-2 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-200 px-6 py-3 rounded-xl font-semibold hover:bg-stone-50 dark:hover:bg-stone-800 transition-all"
              >
                <Pause size={18} fill="currentColor" />
                Пауза
              </button>
              <button 
                onClick={handleFinish}
                className="flex items-center gap-2 bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 px-6 py-3 rounded-xl font-semibold shadow-lg shadow-stone-200 dark:shadow-none hover:scale-105 transition-all"
              >
                <Square size={18} fill="currentColor" />
                Завершить
              </button>
            </>
          )}
          {status === 'paused' && (
            <>
              <button 
                onClick={handleStart}
                className="flex items-center gap-2 bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 px-6 py-3 rounded-xl font-semibold shadow-lg shadow-stone-200 dark:shadow-none hover:scale-105 transition-all"
              >
                <Play size={18} fill="currentColor" />
                Продолжить
              </button>
              <button 
                onClick={handleFinish}
                className="flex items-center gap-2 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-200 px-6 py-3 rounded-xl font-semibold hover:bg-stone-50 dark:hover:bg-stone-800 transition-all"
              >
                <Square size={18} fill="currentColor" />
                Завершить
              </button>
            </>
          )}
          {(status === 'writing' || status === 'paused') && (
            <button 
              onClick={handleCancel}
              className="p-3 text-stone-400 hover:text-red-500 transition-colors"
              title="Отменить сессию"
            >
              <X size={24} />
            </button>
          )}
        </div>
      </div>

      {/* Editor Area */}
      <div className="relative group">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          disabled={status === 'idle' || status === 'paused'}
          placeholder={status === 'idle' ? "Нажмите 'Начать сессию', чтобы приступить к письму..." : "Пишите всё, что на уме..."}
          className={cn(
            "w-full min-h-[500px] p-12 bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-sm focus:shadow-xl focus:border-stone-300 dark:focus:border-stone-700 transition-all outline-none text-xl leading-relaxed resize-none dark:text-stone-100",
            (status === 'idle' || status === 'paused') && "opacity-50 cursor-not-allowed"
          )}
        />
        
        {status !== 'idle' && (
          <div className="absolute bottom-6 right-8 flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer group/label">
              <input 
                type="checkbox" 
                checked={isPublic} 
                onChange={(e) => setIsPublic(e.target.checked)}
                className="hidden"
              />
              <div className={cn(
                "w-10 h-6 rounded-full p-1 transition-colors duration-300 flex items-center",
                isPublic ? "bg-emerald-500" : "bg-stone-200 dark:bg-stone-800"
              )}>
                <motion.div 
                  animate={{ x: isPublic ? 16 : 0 }}
                  className="w-4 h-4 bg-white rounded-full shadow-sm"
                />
              </div>
              <span className="text-sm font-medium text-stone-500 dark:text-stone-400 group-hover/label:text-stone-900 dark:group-hover/label:text-stone-100 transition-colors flex items-center gap-1.5">
                {isPublic ? <Globe size={14} /> : <Lock size={14} />}
                {isPublic ? "Публично" : "Приватно"}
              </span>
            </label>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode, label: string, value: string }) {
  return (
    <div className="bg-stone-50 dark:bg-stone-950 p-4 rounded-2xl border border-stone-100 dark:border-stone-800 flex flex-col items-center text-center">
      <div className="text-stone-400 dark:text-stone-500 mb-1">{icon}</div>
      <span className="text-[10px] font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest">{label}</span>
      <span className="text-xl font-mono font-medium text-stone-900 dark:text-stone-100">{value}</span>
    </div>
  );
}

function AIButton({ onClick, label, icon, active }: { onClick: () => void, label: string, icon: React.ReactNode, active: boolean }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all",
        active ? "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900" : "bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function ArchiveView({ user }: { user: User }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'sessions'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Session));
      setSessions(docs);
      setLoading(false);
    });

    return unsubscribe;
  }, [user.uid]);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-12"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-4xl font-bold dark:text-stone-100">Ваш архив</h2>
        <div className="flex items-center gap-2 text-stone-400 dark:text-stone-500">
          <History size={20} />
          <span className="font-medium">{sessions.length} сессий</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
        <div className="lg:col-span-2 space-y-6">
          {loading ? (
            <div className="text-stone-400 italic">Загрузка истории...</div>
          ) : sessions.length === 0 ? (
            <div className="p-12 bg-white dark:bg-stone-900 rounded-3xl border border-dashed border-stone-300 dark:border-stone-700 text-center space-y-4">
              <PenLine size={48} className="mx-auto text-stone-200 dark:text-stone-800" />
              <p className="text-stone-500 dark:text-stone-400 font-medium text-xl">Пока здесь пусто. Время что-нибудь написать!</p>
            </div>
          ) : (
            sessions.map(session => (
              <SessionCard key={session.id} session={session} />
            ))
          )}
        </div>

        <div className="space-y-8">
          <Calendar sessions={sessions} />
        </div>
      </div>
    </motion.div>
  );
}

function FeedView() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'sessions'),
      where('isPublic', '==', true),
      orderBy('createdAt', 'desc'),
      limit(20)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Session));
      setSessions(docs);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-12"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-4xl font-bold dark:text-stone-100">Лента сообщества</h2>
        <div className="flex items-center gap-2 text-stone-400 dark:text-stone-500">
          <Globe size={20} />
          <span className="font-medium">Публичные сессии</span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto space-y-8">
        {loading ? (
          <div className="text-stone-400 italic text-center">Читаем ленту...</div>
        ) : sessions.length === 0 ? (
          <div className="text-center text-stone-400 italic text-xl py-20">В ленте пока тихо. Будьте первым, кто поделится!</div>
        ) : (
          sessions.map(session => (
            <SessionCard key={session.id} session={session} showAuthor />
          ))
        )}
      </div>
    </motion.div>
  );
}

function SessionCard({ session, showAuthor }: { session: Session, showAuthor?: boolean }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div 
      layout
      className="bg-white dark:bg-stone-900 p-8 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-sm hover:shadow-md transition-all space-y-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {showAuthor && (
            <img src={session.authorPhoto} className="w-8 h-8 rounded-full border border-stone-100 dark:border-stone-800" referrerPolicy="no-referrer" />
          )}
          <div className="flex flex-col">
            <span className="text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest">
              {format(new Date(session.createdAt), 'd MMM yyyy • HH:mm')}
            </span>
            {showAuthor && <span className="font-medium text-stone-900 dark:text-stone-100">{session.authorName}</span>}
          </div>
        </div>
        <div className="flex items-center gap-4 text-stone-400 dark:text-stone-500 text-sm font-mono">
          <span className="flex items-center gap-1"><Clock size={14} /> {Math.floor(session.duration / 60)}м</span>
          <span className="flex items-center gap-1"><Type size={14} /> {session.wordCount}сл</span>
          {session.isPublic ? <Globe size={14} /> : <Lock size={14} />}
        </div>
      </div>

      <div className={cn(
        "prose prose-stone dark:prose-invert max-w-none text-lg leading-relaxed",
        !expanded && "line-clamp-3"
      )}>
        {session.content}
      </div>

      <button 
        onClick={() => setExpanded(!expanded)}
        className="text-stone-400 dark:text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 text-sm font-medium transition-colors"
      >
        {expanded ? "Свернуть" : "Читать далее"}
      </button>
    </motion.div>
  );
}

function Calendar({ sessions }: { sessions: Session[] }) {
  const today = new Date();
  const start = startOfMonth(today);
  const end = endOfMonth(today);
  const days = eachDayOfInterval({ start, end });

  const activeDays = sessions.map(s => new Date(s.createdAt));

  return (
    <div className="bg-white dark:bg-stone-900 p-6 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-sm space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-xl dark:text-stone-100">{format(today, 'LLLL yyyy')}</h3>
        <CalendarIcon size={18} className="text-stone-400 dark:text-stone-500" />
      </div>

      <div className="grid grid-cols-7 gap-2">
        {['В', 'П', 'В', 'С', 'Ч', 'П', 'С'].map((d, i) => (
          <div key={`${d}-${i}`} className="text-[10px] font-bold text-stone-300 dark:text-stone-600 text-center py-1">{d}</div>
        ))}
        {days.map(day => {
          const isActive = activeDays.some(ad => isSameDay(ad, day));
          return (
            <div 
              key={day.toString()}
              className={cn(
                "aspect-square rounded-lg flex items-center justify-center text-xs transition-all",
                isActive ? "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 font-bold" : "text-stone-400 dark:text-stone-500 hover:bg-stone-50 dark:hover:bg-stone-800",
                isToday(day) && !isActive && "border border-stone-900 dark:border-stone-100 text-stone-900 dark:text-stone-100"
              )}
            >
              {format(day, 'd')}
            </div>
          );
        })}
      </div>

      <div className="pt-4 border-t border-stone-50 dark:border-stone-800 flex items-center justify-between text-[10px] font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest">
        <span>Серия</span>
        <span className="text-stone-900 dark:text-stone-100 text-sm">3 Дня</span>
      </div>
    </div>
  );
}
