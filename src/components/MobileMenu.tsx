import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, PenLine, History, User as UserIcon, Globe, Shield, LogOut } from 'lucide-react';
import { MobileNavButton } from './MobileNavButton';
import { signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';

interface MobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  view: string;
  setView: (view: any) => void;
  isAdmin: boolean;
}

export function MobileMenu({ isOpen, onClose, view, setView, isAdmin }: MobileMenuProps) {
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
            className="fixed top-0 left-0 bottom-0 w-[280px] bg-white dark:bg-stone-900 z-[70] shadow-2xl border-r border-stone-200 dark:border-stone-800 p-6 flex flex-col"
          >
            <div className="flex items-center justify-between mb-10">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-stone-900 dark:bg-stone-100 rounded-lg flex items-center justify-center text-white dark:text-stone-900 font-bold text-xl">J</div>
                <span className="font-bold text-xl tracking-tight">justwriting.one</span>
              </div>
              <button 
                onClick={onClose}
                className="p-2 text-stone-400 hover:text-stone-900 dark:hover:text-stone-100"
              >
                <X size={24} />
              </button>
            </div>

            <div className="flex flex-col gap-2 flex-1">
              <MobileNavButton 
                active={view === 'write'} 
                onClick={() => { setView('write'); onClose(); }} 
                icon={<PenLine size={20} />} 
                label="Писать" 
              />
              <MobileNavButton 
                active={view === 'archive'} 
                onClick={() => { setView('archive'); onClose(); }} 
                icon={<History size={20} />} 
                label="Архив" 
              />
              <MobileNavButton 
                active={view === 'profile'} 
                onClick={() => { setView('profile'); onClose(); }} 
                icon={<UserIcon size={20} />} 
                label="Профиль" 
              />
              <MobileNavButton 
                active={view === 'feed'} 
                onClick={() => { setView('feed'); onClose(); }} 
                icon={<Globe size={20} />} 
                label="Лента" 
              />
              {isAdmin && (
                <MobileNavButton 
                  active={view === 'admin'} 
                  onClick={() => { setView('admin'); onClose(); }} 
                  icon={<Shield size={20} className="text-red-500" />} 
                  label="Админ-панель" 
                />
              )}
            </div>

            <button 
              onClick={() => signOut(auth)}
              className="mt-auto flex items-center gap-3 p-4 text-stone-500 hover:text-red-500 transition-colors font-semibold"
            >
              <LogOut size={20} />
              Выйти
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
