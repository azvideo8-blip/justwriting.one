import React, { useState } from 'react';
import { PenLine, History, User as UserIcon, Globe, Settings, Monitor, Smartphone, Shield } from 'lucide-react';
import { User } from 'firebase/auth';
import { useLanguage } from '../../../core/i18n';
import { cn } from '../../../core/utils/utils';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { useSettings } from '../../../core/settings/SettingsContext';

interface BetaSidebarProps {
  view: string;
  setView: (view: any) => void;
  isAdmin: boolean;
  user: User;
}

export function BetaSidebar({ view, setView, isAdmin, user }: BetaSidebarProps) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useLanguage();
  const { layoutMode, setLayoutMode } = useLayoutMode();
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
    <div
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      className={cn(
        "fixed top-0 left-0 h-full z-50 flex flex-col py-4 transition-all duration-300 ease-in-out",
        "bg-surface-card border-r border-border-subtle backdrop-blur-xl",
        expanded ? "w-[220px]" : "w-16"
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
            onClick={() => item.action ? item.action() : setView(item.id)}
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

      {/* Bottom actions */}
      <div className="flex flex-col gap-1 px-2 pt-4 border-t border-border-subtle">
        {/* Layout toggle */}
        <button
          onClick={() => setLayoutMode(layoutMode === 'desktop' ? 'mobile' : 'desktop')}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-text-main/50 hover:text-text-main hover:bg-text-main/8 transition-all w-full overflow-hidden"
          title={layoutMode === 'desktop' ? t('layout_switch_mobile') : t('layout_switch_desktop')}
        >
          <span className="shrink-0">
            {layoutMode === 'desktop' ? <Monitor size={18} /> : <Smartphone size={18} />}
          </span>
          <span className={cn(
            "text-sm font-medium whitespace-nowrap transition-opacity duration-200",
            expanded ? "opacity-100" : "opacity-0 w-0 overflow-hidden"
          )}>
            {layoutMode === 'desktop' ? t('layout_switch_mobile') : t('layout_switch_desktop')}
          </span>
        </button>
      </div>
    </div>
  );
}
