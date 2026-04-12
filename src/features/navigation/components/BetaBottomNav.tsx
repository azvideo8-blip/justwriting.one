import React from 'react';
import { PenLine, History, User as UserIcon, Globe, Shield } from 'lucide-react';
import { User } from 'firebase/auth';
import { useLanguage } from '../../../core/i18n';
import { cn } from '../../../core/utils/utils';

interface BetaBottomNavProps {
  view: string;
  setView: (view: any) => void;
  isAdmin: boolean;
  user: User;
}

export function BetaBottomNav({ view, setView, isAdmin, user }: BetaBottomNavProps) {
  const { t } = useLanguage();

  const navItems = [
    { id: 'write',    icon: <PenLine size={20} />,  label: t('nav_write_short') },
    { id: 'archive',  icon: <History size={20} />,  label: t('nav_notes_short') },
    { id: 'profile',  icon: <UserIcon size={20} />, label: t('nav_profile_short') },
    { id: 'feed',     icon: <Globe size={20} />,    label: t('nav_community_short') },
    ...(isAdmin ? [{ id: 'admin', icon: <Shield size={20} className="text-red-400" />, label: t('nav_admin') }] : []),
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-surface-card border-t border-border-subtle backdrop-blur-xl pb-4">
      <div className="flex items-center px-2 py-2 gap-1">
        <div className="flex items-center justify-between w-full gap-1">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={cn(
                "flex flex-col items-center gap-1 py-2 px-3 rounded-xl transition-all duration-200 min-w-[52px]",
                view === item.id
                  ? "bg-text-main text-surface-base"
                  : "text-text-main/50 hover:text-text-main"
              )}
            >
              {item.icon}
              <span className="text-[9px] font-bold uppercase tracking-wide leading-none">
                {item.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
