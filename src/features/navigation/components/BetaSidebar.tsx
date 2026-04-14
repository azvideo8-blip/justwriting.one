import React, { useState } from 'react';
import { PenLine, History, User as UserIcon, Globe, Shield } from 'lucide-react';
import { User } from 'firebase/auth';
import { useLanguage } from '../../../core/i18n';
import { cn } from '../../../core/utils/utils';

interface BetaSidebarProps {
  view: string;
  setView: (view: any) => void;
  isAdmin: boolean;
  user: User;
  isZenActive?: boolean;
}

export function BetaSidebar({ view, setView, isAdmin, user, isZenActive }: BetaSidebarProps) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useLanguage();

  const navItems = [
    { id: 'write',    icon: <PenLine size={20} />,   label: t('nav_write') },
    { id: 'archive',  icon: <History size={20} />,   label: t('nav_notes') },
    { id: 'profile',  icon: <UserIcon size={20} />,  label: t('nav_profile') },
    { id: 'feed',     icon: <Globe size={20} />,     label: t('nav_community') },
    ...(isAdmin ? [{ id: 'admin', icon: <Shield size={20} className="text-red-400" />, label: t('nav_admin') }] : []),
  ];

  return (
    <div
      role="navigation"
      aria-label={t('nav_main')}
      onFocusCapture={() => setExpanded(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setExpanded(false);
      }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      className={cn(
        "fixed top-0 left-0 h-full z-50 flex flex-col py-4 transition-all duration-300 ease-in-out",
        "bg-surface-card border-r border-border-subtle backdrop-blur-xl",
        expanded ? "w-[220px]" : "w-16",
        isZenActive ? "opacity-0 pointer-events-none -translate-x-4" : "opacity-100 translate-x-0"
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 mb-8 h-10 overflow-hidden">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-lg bg-text-main text-surface-base shrink-0">
          J
        </div>
        <span className={cn(
          "font-bold text-lg text-text-main whitespace-nowrap transition-opacity duration-200",
          expanded ? "opacity-100" : "opacity-0"
        )}>
          justwriting
        </span>
      </div>

      {/* Nav items */}
      <nav className="flex-1 flex flex-col gap-1 px-2">
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            aria-current={view === item.id ? 'page' : undefined}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 text-left w-full overflow-hidden",
              view === item.id
                ? "bg-text-main text-surface-base"
                : "text-text-main/50 hover:text-text-main hover:bg-text-main/8"
            )}
          >
            <span className="shrink-0">{item.icon}</span>
            <span className={cn(
              "text-sm font-medium whitespace-nowrap transition-opacity duration-200",
              expanded ? "opacity-100" : "opacity-0"
            )}>
              {item.label}
            </span>
          </button>
        ))}
      </nav>
    </div>
  );
}
