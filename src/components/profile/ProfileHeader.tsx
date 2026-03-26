import React, { useState } from 'react';
import { User } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { User as UserIcon, PenLine, TrendingUp, Check, X } from 'lucide-react';
import { db } from '../../lib/firebase';
import { handleFirestoreError, OperationType } from '../../lib/firestore-errors';
import { useLanguage } from '../../lib/i18n';
import { UserProfile } from '../../types';

interface ProfileHeaderProps {
  user: User;
  profile: UserProfile | null;
  currentStreak: number;
  totalWords: number;
}

export function ProfileHeader({ user, profile, currentStreak, totalWords }: ProfileHeaderProps) {
  const [editingNickname, setEditingNickname] = useState(false);
  const [newNickname, setNewNickname] = useState(profile?.nickname || '');
  const { t } = useLanguage();

  const handleUpdateNickname = async () => {
    if (!newNickname.trim()) return;
    try {
      await setDoc(doc(db, 'users', user.uid), { nickname: newNickname }, { merge: true });
      setEditingNickname(false);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${user.uid}`);
    }
  };

  return (
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
            <span className="font-bold text-stone-900 dark:text-stone-100">{currentStreak}</span> {t('profile_streak')}
          </div>
          <div className="flex items-center gap-2 text-stone-400 dark:text-stone-500 text-sm">
            <PenLine size={16} />
            <span className="font-bold text-stone-900 dark:text-stone-100">{totalWords}</span> {t('profile_words')}
          </div>
        </div>
      </div>
    </div>
  );
}
