import React, { useState } from 'react';
import { User } from 'firebase/auth';
import { User as UserIcon, PenLine, TrendingUp, Check, X } from 'lucide-react';
import { ProfileService } from '../../../features/profile/services/ProfileService';
import { useLanguage } from '../../../core/i18n';
import { useServiceAction } from '../../../features/writing/hooks/useServiceAction';
import { UserProfile } from '../../../types';

interface ProfileHeaderProps {
  user: User | null;
  profile: UserProfile | null;
  currentStreak: number;
  totalWords: number;
}

export function ProfileHeader({ user, profile, currentStreak, totalWords }: ProfileHeaderProps) {
  const [editingNickname, setEditingNickname] = useState(false);
  const [newNickname, setNewNickname] = useState(profile?.nickname || '');
  const [displayNickname, setDisplayNickname] = useState(profile?.nickname || '');
  const { t } = useLanguage();
  const { execute } = useServiceAction();

  const handleUpdateNickname = () => {
    if (!newNickname.trim() || !user) return;
    execute(
      () => ProfileService.updateNickname(user.uid, newNickname),
      { successMessage: t('save_success'), errorMessage: t('error_nickname_failed'), onSuccess: () => {
        setDisplayNickname(newNickname);
        setEditingNickname(false);
      }}
    );
  };

  return (
    <div className="flex flex-col md:flex-row items-center gap-6">
      <div className="w-24 h-24 rounded-full flex items-center justify-center overflow-hidden border-4 shadow-xl bg-surface-base/10 border-surface-base">
        {user?.photoURL ? (
          <img src={user.photoURL || undefined} alt="Profile photo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <UserIcon size={40} className="text-text-main/50" />
        )}
      </div>
      <div className="flex-1 text-center md:text-left space-y-2">
        <div className="flex flex-col md:flex-row md:items-center gap-2">
          {editingNickname && user ? (
            <div className="flex items-center gap-2">
              <input 
                type="text"
                value={newNickname}
                onChange={(e) => setNewNickname(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleUpdateNickname()}
                className="px-3 py-1 rounded-lg outline-none font-bold bg-surface-base/5 border border-border-subtle text-text-main focus:border-text-main/50"
                autoFocus
              />
              <button onClick={handleUpdateNickname} className="p-1 rounded text-emerald-400 hover:bg-emerald-400/20"><Check size={20} /></button>
              <button onClick={() => setEditingNickname(false)} className="p-1 rounded text-red-400 hover:bg-red-400/20"><X size={20} /></button>
            </div>
          ) : (
            <div className="flex items-center gap-2 justify-center md:justify-start">
              <h2 className="text-3xl font-bold text-text-main">{displayNickname || user?.displayName || t('me_anonymous')}</h2>
              {user && (
                <button onClick={() => setEditingNickname(true)} className="p-1 transition-colors text-text-main/50 hover:text-text-main"><PenLine size={16} /></button>
              )}
            </div>
          )}
        </div>
        {user?.email && <p className="text-text-main/50">{user.email}</p>}
        <div className="flex flex-wrap justify-center md:justify-start gap-4 pt-2">
          <div className="flex items-center gap-2 text-sm text-text-main/50">
            <TrendingUp size={16} />
            <span className="font-bold text-text-main">{currentStreak}</span> {t('profile_streak')}
          </div>
          <div className="flex items-center gap-2 text-sm text-text-main/50">
            <PenLine size={16} />
            <span className="font-bold text-text-main">{totalWords}</span> {t('profile_words')}
          </div>
        </div>
      </div>
    </div>
  );
}
