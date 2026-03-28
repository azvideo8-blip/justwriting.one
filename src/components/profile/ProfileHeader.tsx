import React, { useState } from 'react';
import { User } from 'firebase/auth';
import { User as UserIcon, PenLine, TrendingUp, Check, X } from 'lucide-react';
import { UserService } from '../../services/UserService';
import { useLanguage } from '../../core/i18n';
import { useUI } from '../../contexts/UIContext';
import { cn } from '../../core/utils/utils';

interface ProfileHeaderProps {
  user: User;
  profile: any;
  currentStreak: number;
  totalWords: number;
}

export function ProfileHeader({ user, profile, currentStreak, totalWords }: ProfileHeaderProps) {
  const [editingNickname, setEditingNickname] = useState(false);
  const [newNickname, setNewNickname] = useState(profile?.nickname || '');
  const { t } = useLanguage();
  const { uiVersion } = useUI();
  const isV2 = uiVersion === '2.0';

  const handleUpdateNickname = async () => {
    if (!newNickname.trim()) return;
    await UserService.updateNickname(user.uid, newNickname);
    setEditingNickname(false);
  };

  return (
    <div className={cn(
      "p-8 rounded-3xl flex flex-col md:flex-row items-center gap-6 transition-all",
      isV2 
        ? "bg-[#0A0A0B]/80 backdrop-blur-2xl border border-white/10 shadow-[0_0_60px_rgba(0,0,0,0.8)]" 
        : "bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-sm"
    )}>
      <div className={cn(
        "w-24 h-24 rounded-full flex items-center justify-center overflow-hidden border-4 shadow-xl",
        isV2 ? "bg-white/10 border-[#0A0A0B]" : "bg-stone-100 dark:bg-stone-800 border-white dark:border-stone-900"
      )}>
        {user.photoURL ? (
          <img src={user.photoURL} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <UserIcon size={40} className={isV2 ? "text-white/50" : "text-stone-300"} />
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
                className={cn(
                  "px-3 py-1 rounded-lg outline-none font-bold",
                  isV2 ? "bg-white/5 border border-white/20 text-white focus:border-white/50" : "bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 focus:border-stone-400 dark:text-stone-100"
                )}
                autoFocus
              />
              <button onClick={handleUpdateNickname} className={cn("p-1 rounded", isV2 ? "text-emerald-400 hover:bg-emerald-400/20" : "text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20")}><Check size={20} /></button>
              <button onClick={() => setEditingNickname(false)} className={cn("p-1 rounded", isV2 ? "text-red-400 hover:bg-red-400/20" : "text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20")}><X size={20} /></button>
            </div>
          ) : (
            <div className="flex items-center gap-2 justify-center md:justify-start">
              <h2 className={cn("text-3xl font-bold", isV2 ? "text-white" : "dark:text-stone-100")}>{profile?.nickname || user.displayName}</h2>
              <button onClick={() => setEditingNickname(true)} className={cn("p-1 transition-colors", isV2 ? "text-white/50 hover:text-white" : "text-stone-400 hover:text-stone-900 dark:hover:text-stone-100")}><PenLine size={16} /></button>
            </div>
          )}
        </div>
        <p className={cn(isV2 ? "text-white/50" : "text-stone-500 dark:text-stone-400")}>{user.email}</p>
        <div className="flex flex-wrap justify-center md:justify-start gap-4 pt-2">
          <div className={cn("flex items-center gap-2 text-sm", isV2 ? "text-white/50" : "text-stone-400 dark:text-stone-500")}>
            <TrendingUp size={16} />
            <span className={cn("font-bold", isV2 ? "text-white" : "text-stone-900 dark:text-stone-100")}>{currentStreak}</span> {t('profile_streak')}
          </div>
          <div className={cn("flex items-center gap-2 text-sm", isV2 ? "text-white/50" : "text-stone-400 dark:text-stone-500")}>
            <PenLine size={16} />
            <span className={cn("font-bold", isV2 ? "text-white" : "text-stone-900 dark:text-stone-100")}>{totalWords}</span> {t('profile_words')}
          </div>
        </div>
      </div>
    </div>
  );
}
