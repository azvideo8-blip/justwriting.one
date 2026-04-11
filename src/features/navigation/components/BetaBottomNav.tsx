import React from 'react';
import { PenLine, History, User as UserIcon, Globe, Settings, Shield } from 'lucide-react';
import { User } from 'firebase/auth';
import { useLanguage } from '../../../core/i18n';
import { cn } from '../../../core/utils/utils';
import { useSettings } from '../../../core/settings/SettingsContext';

interface BetaBottomNavProps {
  view: string;
  setView: (view: any) => void;
  isAdmin: boolean;
  user: User;
}

export function BetaBottomNav({ view, setView, isAdmin, user }: BetaBottomNavProps) {
  const { t } = useLanguage();
  const { openSettings } = useSettings();

  const navItems = [
    { id: 'write',    icon: <PenLine size={20} />,   label: t('nav_write') },
    { id: 'archive',  icon: <History size={20} />,   label: t('nav_notes') },
    { id: 'profile',  icon: <UserIcon size={20} />,  label: t('nav_profile') },
    { id: 'feed',     icon: <Globe size={20} />,     label: t('nav_community') },
    { id: 'settings', icon: <Settings size={20} />,  label: t('nav_settings'), action: openSettings },
    ...(isAdmin ? [{ id: 'admin', icon: <Shield size={20} className="text-red-400" />, label: t('nav_admin') }] : []),
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-surface-card border-t border-border-subtle backdrop-blur-xl pb-4">
      <div className="flex items-center px-2 py-2 gap-1">
        <div className="flex items-center justify-between w-full gap-1">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => item.action ? item.action() : setView(item.id)}
              className={cn(
                "flex flex-col items-center justify-center p-2.5 rounded-xl transition-all duration-200 min-w-[48px]",
                view === item.id
                  ? "bg-text-main text-surface-base"
                  : "text-text-main/50 hover:text-text-main hover:bg-text-main/8"
              )}
            >
              {item.icon}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
