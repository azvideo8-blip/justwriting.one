import React from 'react';
import { NavButton } from './NavButton';
import { PenLine, History, User as UserIcon, Globe, Shield, LogOut, Brain } from 'lucide-react';
import { User } from 'firebase/auth';
import { signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { useLanguage } from '../lib/i18n';
import { useUI } from '../contexts/UIContext';
import { cn } from '../lib/utils';

interface DesktopNavProps {
  view: string;
  setView: (view: any) => void;
  isAdmin: boolean;
  user: User;
}

export function DesktopNav({ view, setView, isAdmin, user }: DesktopNavProps) {
  const { language, setLanguage, t } = useLanguage();
  const { uiVersion, toggleUIVersion } = useUI();

  return (
    <div className="hidden md:flex items-center gap-6">
      <button
        onClick={toggleUIVersion}
        className="px-2 py-1 rounded-md bg-stone-200 dark:bg-stone-800 text-xs font-bold"
      >
        UI v{uiVersion}
      </button>
      <NavButton active={view === 'write'} onClick={() => setView('write')} icon={<PenLine size={18} />} label={t('nav_write')} />
      <NavButton active={view === 'archive'} onClick={() => setView('archive')} icon={<History size={18} />} label={t('nav_notes')} />
      <NavButton active={view === 'profile'} onClick={() => setView('profile')} icon={<UserIcon size={18} />} label={t('nav_profile')} />
      <NavButton 
        active={view === 'feed'} 
        onClick={() => setView('feed')} 
        icon={<Globe size={18} className={view === 'feed' ? "text-emerald-500" : ""} />} 
        label={t('nav_community')}
        className={view === 'feed' ? "text-emerald-500" : "hover:text-emerald-500"}
      />
      {isAdmin && (
        <NavButton active={view === 'admin'} onClick={() => setView('admin')} icon={<Shield size={18} className="text-red-500" />} label={t('nav_admin')} />
      )}
      
      <div className="h-6 w-px bg-stone-200 dark:bg-stone-800 mx-2" />
      
      <div className="flex items-center gap-4">
        <button 
          onClick={() => setLanguage(language === 'ru' ? 'en' : 'ru')}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-all text-xs font-bold"
          title={language === 'ru' ? 'Switch to English' : 'Переключить на русский'}
        >
          <span>{language === 'ru' ? '🇷🇺 RU' : '🇺🇸 EN'}</span>
        </button>

        <button 
          onClick={() => signOut(auth)}
          className="flex items-center gap-3 text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100 transition-colors group"
          title={t('nav_logout')}
        >
          <div className="relative">
            <img src={user.photoURL || ''} className="w-8 h-8 rounded-full border border-stone-200 dark:border-stone-800 group-hover:border-stone-400 transition-colors" referrerPolicy="no-referrer" />
            <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-emerald-500 border-2 border-white dark:border-stone-900 rounded-full" />
          </div>
          <LogOut size={18} className="group-hover:translate-x-1 transition-transform" />
        </button>
      </div>
    </div>
  );
}
