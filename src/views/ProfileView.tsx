import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { User } from 'firebase/auth';
import { 
  collection, query, where, orderBy, onSnapshot, doc, setDoc 
} from 'firebase/firestore';
import { 
  TrendingUp, PenLine, User as UserIcon, Sparkles, Check, X 
} from 'lucide-react';
import { db } from '../lib/firebase';
import { Session } from '../types';
import { calculateStreak } from '../lib/utils';
import { ACHIEVEMENTS } from '../constants/achievements';
import { SessionChart } from '../components/SessionChart';
import { AchievementSection } from '../components/AchievementSection';
import { Calendar } from '../components/Calendar';

interface ProfileViewProps {
  user: User;
  profile: any;
}

export function ProfileView({ user, profile }: ProfileViewProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [editingNickname, setEditingNickname] = useState(false);
  const [newNickname, setNewNickname] = useState(profile?.nickname || '');

  useEffect(() => {
    const q = query(
      collection(db, 'sessions'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Session));
      setSessions(docs);
    });

    return unsubscribe;
  }, [user.uid]);

  const handleUpdateNickname = async () => {
    if (!newNickname.trim()) return;
    try {
      await setDoc(doc(db, 'users', user.uid), { nickname: newNickname }, { merge: true });
      setEditingNickname(false);
    } catch (e) {
      console.error("Update nickname error:", e);
    }
  };

  const allTags = Array.from(new Set(sessions.flatMap(s => s.tags || [])));
  const currentStreak = calculateStreak(sessions);
  const totalWords = sessions.reduce((acc, s) => acc + s.wordCount, 0);
  const totalNotes = sessions.length;
  const maxSessionDuration = sessions.reduce((acc, s) => Math.max(acc, s.duration / 60), 0);

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
