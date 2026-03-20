import React from 'react';
import { NavButton } from './NavButton';
import { PenLine, History, User as UserIcon, Globe, Shield, LogOut } from 'lucide-react';
import { User } from 'firebase/auth';
import { signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';

interface DesktopNavProps {
  view: string;
  setView: (view: any) => void;
  isAdmin: boolean;
  user: User;
}

export function DesktopNav({ view, setView, isAdmin, user }: DesktopNavProps) {
  return (
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
        onClick={() => signOut(auth)}
        className="flex items-center gap-2 text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100 transition-colors"
        title="Выйти"
      >
        <img src={user.photoURL || ''} className="w-8 h-8 rounded-full border border-stone-200 dark:border-stone-800" referrerPolicy="no-referrer" />
        <LogOut size={18} />
      </button>
    </div>
  );
}
