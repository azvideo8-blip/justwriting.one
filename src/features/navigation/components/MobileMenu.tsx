import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, PenLine, History, User as UserIcon, Globe, Shield, LogOut, Languages } from 'lucide-react';
import { MobileNavButton } from './MobileNavButton';
import { signOut } from 'firebase/auth';
import { auth } from '../../../core/firebase/auth';
import { useLanguage } from '../../../core/i18n';
import { cn } from '../../../core/utils/utils';

interface MobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  view: string;
  setView: (view: 'write' | 'profile' | 'archive' | 'feed' | 'admin') => void;
  isAdmin: boolean;
}

export function MobileMenu({ isOpen, onClose, view, setView, isAdmin }: MobileMenuProps) {
  const { language, setLanguage, t } = useLanguage();

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-surface-base/20 backdrop-blur-sm z-[60]"
          />
          <motion.div 
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed top-0 left-0 bottom-0 w-[300px] z-[70] shadow-2xl p-8 flex flex-col bg-surface-card/80 backdrop-blur-2xl border-r border-border-subtle"
          >
            <div className="flex items-center justify-between mb-12">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-2xl shadow-lg bg-surface-base text-text-main border border-border-subtle shadow-[0_0_20px_rgba(255,255,255,0.2)]">J</div>
                <span className="font-black text-2xl tracking-tighter text-text-main">justwriting</span>
              </div>
              <button 
                onClick={onClose}
                className="p-3 transition-colors text-text-main/50 hover:text-text-main"
                aria-label={t('common_close')}
              >
                <X size={24} strokeWidth={2.5} />
              </button>
            </div>

            <div className="flex flex-col gap-3 flex-1 overflow-y-auto no-scrollbar">
              <MobileNavButton 
                active={view === 'write'} 
                onClick={() => { setView('write'); onClose(); }} 
                icon={<PenLine size={22} />} 
                label={t('nav_write')} 
              />
              <MobileNavButton 
                active={view === 'archive'} 
                onClick={() => { setView('archive'); onClose(); }} 
                icon={<History size={22} />} 
                label={t('nav_notes')} 
              />
              <MobileNavButton 
                active={view === 'profile'} 
                onClick={() => { setView('profile'); onClose(); }} 
                icon={<UserIcon size={22} />} 
                label={t('nav_profile')} 
              />
              <MobileNavButton 
                active={view === 'feed'} 
                onClick={() => { setView('feed'); onClose(); }} 
                icon={<Globe size={22} className={view === 'feed' ? "text-emerald-500" : ""} />} 
                label={t('nav_community')}
                className={view === 'feed' ? "text-emerald-500" : ""}
              />
              {isAdmin && (
                <MobileNavButton 
                  active={view === 'admin'} 
                  onClick={() => { setView('admin'); onClose(); }} 
                  icon={<Shield size={22} className="text-red-500" />} 
                  label={t('nav_admin')} 
                />
              )}
            </div>

            <div className="mt-auto pt-8 space-y-6">
              <div className="h-px w-full bg-border-subtle" />
              
              <button 
                onClick={() => setLanguage(language === 'ru' ? 'en' : 'ru')}
                className="w-full flex items-center justify-between p-5 rounded-2xl font-black text-sm uppercase tracking-widest transition-all border bg-surface-base/5 text-text-main/50 hover:bg-surface-base/10 hover:text-text-main border-border-subtle/5 hover:border-border-subtle/10"
                aria-label={language === 'ru' ? 'Switch to English' : 'Переключить на русский'}
              >
                <div className="flex items-center gap-3">
                  <Languages size={20} />
                  <span>{language === 'ru' ? 'English' : 'Русский'}</span>
                </div>
                <span className="text-xl">{language === 'ru' ? '🇺🇸' : '🇷🇺'}</span>
              </button>

              <button 
                onClick={() => signOut(auth)}
                className="w-full flex items-center gap-4 p-5 transition-all font-black text-sm uppercase tracking-widest group text-text-main/50 hover:text-red-400"
                aria-label={t('nav_logout')}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center transition-colors bg-surface-base/5 group-hover:bg-red-500/10">
                  <LogOut size={20} />
                </div>
                {t('nav_logout')}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
