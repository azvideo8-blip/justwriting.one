import React from 'react';
import { NavButton } from './NavButton';
import { PenLine, History, User as UserIcon, Globe, Shield, LogOut, Settings } from 'lucide-react';
import { User, signOut } from 'firebase/auth';
import { auth } from '../../../core/firebase/auth';
import { useLanguage } from '../../../core/i18n';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSettings } from '../../../core/settings/SettingsContext';
import { cn } from '../../../core/utils/utils';

interface DesktopNavProps {
  isAdmin: boolean;
  user: User;
}

export function DesktopNav({ isAdmin, user }: DesktopNavProps) {
  const { language, setLanguage, t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const { openSettings } = useSettings();

  return (
    <div className="hidden lg:flex items-center gap-4 lg:gap-6">
      <NavButton active={location.pathname === '/'} onClick={() => navigate('/')} icon={<PenLine size={18} />} label={t('nav_write')} />
      <NavButton active={location.pathname === '/archive'} onClick={() => navigate('/archive')} icon={<History size={18} />} label={t('nav_notes')} />
      <NavButton active={location.pathname === '/profile'} onClick={() => navigate('/profile')} icon={<UserIcon size={18} />} label={t('nav_profile')} />
      <NavButton 
        active={location.pathname === '/feed'} 
        onClick={() => navigate('/feed')} 
        icon={<Globe size={18} className={location.pathname === '/feed' ? "text-emerald-500" : ""} />} 
        label={t('nav_community')}
        className={location.pathname === '/feed' ? "text-emerald-500" : "hover:text-emerald-500"}
      />
      <button
        onClick={() => openSettings()}
        className={cn("flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors", "text-text-main/50 hover:text-text-main")}
      >
        <Settings size={18} />
        <span>{t('nav_settings')}</span>
      </button>
      {isAdmin && (
        <NavButton active={location.pathname === '/admin'} onClick={() => navigate('/admin')} icon={<Shield size={18} className="text-red-500" />} label={t('nav_admin')} />
      )}
      
      <div className="h-6 w-px bg-border-subtle mx-2" />
      
      <div className="flex items-center gap-4">
        <button 
          onClick={() => setLanguage(language === 'ru' ? 'en' : 'ru')}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-base/5 text-text-main/70 hover:text-text-main transition-all text-xs font-bold"
          title={language === 'ru' ? 'Switch to English' : 'Переключить на русский'}
          aria-label={language === 'ru' ? 'Switch to English' : 'Переключить на русский'}
        >
          <span>{language === 'ru' ? '🇷🇺 RU' : '🇺🇸 EN'}</span>
        </button>

        <button 
          onClick={() => signOut(auth)}
          className="flex items-center gap-3 text-text-main/50 hover:text-text-main transition-colors group"
          title={t('nav_logout')}
          aria-label={t('nav_logout')}
        >
          <div className="relative">
            <img src={user.photoURL || undefined} className="w-8 h-8 rounded-full border border-border-subtle group-hover:border-text-main/50 transition-colors" referrerPolicy="no-referrer" />
            <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-emerald-500 border-2 border-surface-base rounded-full" />
          </div>
          <LogOut size={18} className="group-hover:translate-x-1 transition-transform" />
        </button>
      </div>
    </div>
  );
}
