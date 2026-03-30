import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, PenLine, History, User as UserIcon, Globe, Shield, LogOut, Languages } from 'lucide-react';
import { MobileNavButton } from './MobileNavButton';
import { signOut } from 'firebase/auth';
import { auth } from '../../../core/firebase/auth';
import { useLanguage } from '../../../core/i18n';
import { useUI } from '../../../contexts/UIContext';
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
  const { uiVersion } = useUI();
  const isV2 = uiVersion === '2.0';

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-sm z-[60]"
          />
          <motion.div 
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className={cn(
              "fixed top-0 left-0 bottom-0 w-[300px] z-[70] shadow-2xl p-8 flex flex-col",
              isV2 
                ? "bg-[#0A0A0B]/80 backdrop-blur-2xl border-r border-white/10" 
                : "bg-white dark:bg-stone-900 border-r border-stone-200 dark:border-stone-800"
            )}
          >
            <div className="flex items-center justify-between mb-12">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center font-black text-2xl shadow-lg",
                  isV2 ? "bg-white text-black" : "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900"
                )}>J</div>
                <span className={cn("font-black text-2xl tracking-tighter", isV2 ? "text-white" : "dark:text-stone-100")}>justwriting</span>
              </div>
              <button 
                onClick={onClose}
                className={cn(
                  "p-2 transition-colors",
                  isV2 ? "text-white/50 hover:text-white" : "text-stone-400 hover:text-stone-900 dark:hover:text-stone-100"
                )}
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
              <div className={cn("h-px w-full", isV2 ? "bg-white/10" : "bg-stone-100 dark:bg-stone-800")} />
              
              <button 
                onClick={() => setLanguage(language === 'ru' ? 'en' : 'ru')}
                className={cn(
                  "w-full flex items-center justify-between p-5 rounded-2xl font-black text-sm uppercase tracking-widest transition-all border",
                  isV2 
                    ? "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white border-white/5 hover:border-white/10" 
                    : "bg-stone-50 dark:bg-stone-800/50 text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 border-transparent hover:border-stone-200 dark:hover:border-stone-700"
                )}
              >
                <div className="flex items-center gap-3">
                  <Languages size={20} />
                  <span>{language === 'ru' ? 'English' : 'Русский'}</span>
                </div>
                <span className="text-xl">{language === 'ru' ? '🇺🇸' : '🇷🇺'}</span>
              </button>

              <button 
                onClick={() => signOut(auth)}
                className={cn(
                  "w-full flex items-center gap-4 p-5 transition-all font-black text-sm uppercase tracking-widest group",
                  isV2 ? "text-white/50 hover:text-red-400" : "text-stone-500 hover:text-red-500"
                )}
              >
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                  isV2 ? "bg-white/5 group-hover:bg-red-500/10" : "bg-stone-50 dark:bg-stone-800/50 group-hover:bg-red-50 dark:group-hover:bg-red-500/10"
                )}>
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
