import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { User } from 'firebase/auth';
import { onSnapshot, collection, query, where, orderBy, doc, setDoc } from 'firebase/firestore';
import { 
  TrendingUp, PenLine, User as UserIcon, Sparkles, Check, X, Cloud, ArrowLeft
} from 'lucide-react';
import { db } from '../lib/firebase';
import { Session } from '../types';
import { calculateStreak, parseFirestoreDate } from '../lib/utils';
import { ACHIEVEMENTS } from '../constants/achievements';
import { SessionChart } from '../components/SessionChart';
import { AchievementSection } from '../components/AchievementSection';
import { Calendar } from '../components/Calendar';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';

interface ProfileViewProps {
  user: User;
  profile: any;
}

export function ProfileView({ user, profile }: ProfileViewProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [editingNickname, setEditingNickname] = useState(false);
  const [newNickname, setNewNickname] = useState(profile?.nickname || '');
  const [selectedWord, setSelectedWord] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'sessions'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Session));
      setSessions(docs);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'sessions');
    });

    return unsubscribe;
  }, [user.uid]);

  const handleUpdateNickname = async () => {
    if (!newNickname.trim()) return;
    try {
      await setDoc(doc(db, 'users', user.uid), { nickname: newNickname }, { merge: true });
      setEditingNickname(false);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${user.uid}`);
    }
  };

  const allTags = Array.from(new Set(sessions.flatMap(s => s.tags || [])));
  const currentStreak = calculateStreak(sessions);
  const totalWords = sessions.reduce((acc, s) => acc + s.wordCount, 0);
  const totalNotes = sessions.length;
  const maxSessionDuration = sessions.reduce((acc, s) => Math.max(acc, s.duration / 60), 0);

  // Word Cloud Logic
  const getWordCloud = () => {
    const stopWords = new Set(['меня', 'тебя', 'было', 'есть', 'если', 'когда', 'только', 'через', 'после', 'этого', 'потому', 'чтобы', 'будет', 'очень', 'просто', 'можно', 'нужно', 'хотя', 'перед', 'между', 'вдоль', 'кроме', 'вместо', 'ввиду', 'вслед', 'среди', 'будто', 'словно', 'точно', 'ровно', 'почти', 'разве', 'неужели', 'даже', 'лишь', 'хоть', 'пусть', 'пускай', 'давай', 'именно', 'как', 'что', 'это', 'все', 'так', 'вот', 'уже', 'был', 'была', 'были', 'для', 'его', 'ее', 'их', 'нам', 'вам', 'мне', 'тебе', 'себе', 'свои', 'свой', 'своя', 'свое', 'всех', 'всего', 'всем', 'всеми', 'эти', 'этих', 'этим', 'этими', 'этот', 'эта', 'это', 'эту', 'этой', 'этом']);
    const words: Record<string, number> = {};
    
    sessions.forEach(s => {
      const contentWords = s.content.toLowerCase()
        .replace(/[^\w\sа-яё]/gi, '')
        .split(/\s+/)
        .filter(w => w.length > 3 && !stopWords.has(w));
      
      contentWords.forEach(w => {
        words[w] = (words[w] || 0) + 1;
      });
    });

    return Object.entries(words)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30);
  };

  const wordCloud = getWordCloud();
  const filteredSessions = selectedWord 
    ? sessions.filter(s => s.content.toLowerCase().includes(selectedWord.toLowerCase()))
    : [];

  if (selectedWord) {
    return (
      <motion.div 
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        className="space-y-8 pb-20"
      >
        <button 
          onClick={() => setSelectedWord(null)}
          className="flex items-center gap-2 text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 transition-colors font-bold"
        >
          <ArrowLeft size={20} />
          Назад к профилю
        </button>

        <div className="space-y-4">
          <h2 className="text-3xl font-bold dark:text-stone-100">
            Заметки со словом <span className="text-stone-400 italic">"{selectedWord}"</span>
          </h2>
          <p className="text-stone-500">Найдено {filteredSessions.length} сессий</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredSessions.map(session => (
            <div 
              key={session.id}
              className="bg-white dark:bg-stone-900 p-6 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-sm hover:shadow-md transition-all group"
            >
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-xl font-bold dark:text-stone-100 group-hover:text-stone-600 dark:group-hover:text-stone-400 transition-colors">
                  {session.title || 'Без названия'}
                </h3>
                <span className="text-xs font-mono text-stone-400">
                  {parseFirestoreDate(session.createdAt).toLocaleDateString()}
                </span>
              </div>
              <p className="text-stone-600 dark:text-stone-400 line-clamp-3 mb-6 leading-relaxed">
                {session.content}
              </p>
              <div className="flex items-center justify-between pt-4 border-t border-stone-100 dark:border-stone-800">
                <div className="flex items-center gap-4 text-xs text-stone-400">
                  <span className="flex items-center gap-1"><PenLine size={12} /> {session.wordCount} слов</span>
                  <span className="flex items-center gap-1"><TrendingUp size={12} /> {session.wpm} WPM</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-12 pb-20"
    >
      <div className="flex flex-col md:flex-row gap-8 items-start">
        <div className="flex-1 space-y-8">
          {/* User Info */}
          <div className="bg-white dark:bg-stone-900 p-8 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-sm flex flex-col md:flex-row items-center gap-6">
            <div className="w-24 h-24 rounded-full bg-stone-100 dark:bg-stone-800 flex items-center justify-center overflow-hidden border-4 border-white dark:border-stone-900 shadow-xl">
              {user.photoURL ? (
                <img src={user.photoURL} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <UserIcon size={40} className="text-stone-300" />
              )}
            </div>
            <div className="flex-1 text-center md:text-left space-y-2">
              <div className="flex flex-col md:flex-row md:items-center gap-2">
                {editingNickname ? (
                  <div className="flex items-center gap-2">
                    <input 
                      type="text"
                      value={newNickname}
                      onChange={(e) => setNewNickname(e.target.value)}
                      className="px-3 py-1 bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 rounded-lg outline-none focus:border-stone-400 dark:text-stone-100 font-bold"
                      autoFocus
                    />
                    <button onClick={handleUpdateNickname} className="p-1 text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded"><Check size={20} /></button>
                    <button onClick={() => setEditingNickname(false)} className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"><X size={20} /></button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 justify-center md:justify-start">
                    <h2 className="text-3xl font-bold dark:text-stone-100">{profile?.nickname || user.displayName}</h2>
                    <button onClick={() => setEditingNickname(true)} className="p-1 text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors"><PenLine size={16} /></button>
                  </div>
                )}
              </div>
              <p className="text-stone-500 dark:text-stone-400">{user.email}</p>
              <div className="flex flex-wrap justify-center md:justify-start gap-4 pt-2">
                <div className="flex items-center gap-2 text-stone-400 dark:text-stone-500 text-sm">
                  <TrendingUp size={16} />
                  <span className="font-bold text-stone-900 dark:text-stone-100">{currentStreak}</span> дн. стрик
                </div>
                <div className="flex items-center gap-2 text-stone-400 dark:text-stone-500 text-sm">
                  <PenLine size={16} />
                  <span className="font-bold text-stone-900 dark:text-stone-100">{totalWords}</span> слов
                </div>
              </div>
            </div>
          </div>

          {/* Achievements */}
          <div className="space-y-6">
            <h3 className="text-2xl font-bold dark:text-stone-100 flex items-center gap-2">
              <Sparkles className="text-amber-500" /> Достижения
            </h3>
            
            <div className="space-y-8">
              <AchievementSection 
                title="Стрики (дни подряд)" 
                achievements={ACHIEVEMENTS.streaks} 
                currentValue={currentStreak} 
              />
              <AchievementSection 
                title="Общее количество слов" 
                achievements={ACHIEVEMENTS.words} 
                currentValue={totalWords} 
              />
              <AchievementSection 
                title="Количество заметок" 
                achievements={ACHIEVEMENTS.notes} 
                currentValue={totalNotes} 
              />
              <AchievementSection 
                title="Время сессий (макс. за одну)" 
                achievements={ACHIEVEMENTS.duration} 
                currentValue={maxSessionDuration} 
                suffix=" мин"
              />
            </div>
          </div>

          {/* Statistics Chart */}
          <div className="bg-white dark:bg-stone-900 p-8 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold dark:text-stone-100">Активность за неделю</h3>
              <div className="flex items-center gap-2 text-stone-400 dark:text-stone-500 text-xs font-bold uppercase tracking-widest">
                <TrendingUp size={14} />
                Прогресс
              </div>
            </div>
            <SessionChart sessions={sessions} />
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-full md:w-80 shrink-0 space-y-8">
          <Calendar sessions={sessions} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
          
          <div className="bg-white dark:bg-stone-900 p-6 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-sm space-y-4">
            <h3 className="font-bold dark:text-stone-100 flex items-center gap-2">
              <Cloud size={18} className="text-stone-400" />
              Облако слов
            </h3>
            <div className="flex flex-wrap gap-x-3 gap-y-2">
              {wordCloud.length === 0 ? (
                <span className="text-stone-400 text-sm italic">Слов пока нет</span>
              ) : (
                wordCloud.map(([word, count]) => (
                  <button 
                    key={word} 
                    onClick={() => setSelectedWord(word)}
                    className="hover:text-stone-900 dark:hover:text-stone-100 transition-colors"
                    style={{ 
                      fontSize: `${Math.max(0.75, Math.min(1.5, 0.75 + count * 0.1))}rem`,
                      opacity: Math.max(0.5, Math.min(1, 0.5 + count * 0.1)),
                      fontWeight: count > 5 ? 'bold' : 'normal'
                    }}
                  >
                    {word}
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-stone-900 p-6 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-sm space-y-4">
            <h3 className="font-bold dark:text-stone-100">Облако тегов</h3>
            <div className="flex flex-wrap gap-2">
              {allTags.length === 0 ? (
                <span className="text-stone-400 text-sm italic">Тегов пока нет</span>
              ) : (
                allTags.map(tag => (
                  <span key={tag} className="px-3 py-1 bg-stone-50 dark:bg-stone-800 text-stone-600 dark:text-stone-400 rounded-full text-xs font-medium border border-stone-100 dark:border-stone-700">
                    #{tag}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
