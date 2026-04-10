import React from 'react';
import { PenLine, History, User as UserIcon, Globe, Shield } from 'lucide-react';
import { useLanguage } from '../../../core/i18n';
import { cn } from '../../../core/utils/utils';

interface BetaBottomNavProps {
  view: string;
  setView: (view: any) => void;
  isAdmin: boolean;
}

export function BetaBottomNav({ view, setView, isAdmin }: BetaBottomNavProps) {
  const { t } = useLanguage();

  const navItems = [
    { id: 'write',   icon: <PenLine size={22} />,  label: t('nav_write') },
    { id: 'archive', icon: <History size={22} />,  label: t('nav_notes') },
    { id: 'profile', icon: <UserIcon size={22} />, label: t('nav_profile') },
    { id: 'feed',    icon: <Globe size={22} />,    label: t('nav_community') },
    ...(isAdmin ? [{ id: 'admin', icon: <Shield size={22} className="text-red-400" />, label: t('nav_admin') }] : []),
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-surface-card border-t border-border-subtle backdrop-blur-xl safe-area-pb">
      <div className="flex items-center justify-around px-2 py-2">
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            className={cn(
              "flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl transition-all min-w-[56px]",
              view === item.id
                ? "text-text-main"
                : "text-text-main/40 hover:text-text-main/70"
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
  );
}
