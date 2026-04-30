import React, { useState } from 'react';
import { PenLine, History, User as UserIcon, Shield, LogIn, Info } from 'lucide-react';
import { useLanguage } from '../../../core/i18n';
import { cn } from '../../../core/utils/utils';
import { useLocation, useNavigate } from 'react-router-dom';
import { useWritingSettings } from '../../writing/contexts/WritingSettingsContext';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';
import { useLoginModal } from '../../auth/contexts/LoginModalContext';

interface SidebarProps {
  isAdmin: boolean;
  inGrid?: boolean;
}

export function Sidebar({ isAdmin, inGrid: inGridProp }: SidebarProps) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useLanguage();
  const { lifeLogEnabled: _lifeLogEnabled, isZenActive, zenModeEnabled } = useWritingSettings();
  const showZen = isZenActive && zenModeEnabled;
  const inGrid = inGridProp ?? false;
  const location = useLocation();
  const navigate = useNavigate();
  const { isGuest } = useAuthStatus();
  const { openLoginModal } = useLoginModal();

  const navItems = [
    { id: 'write',   path: '/',       icon: <PenLine size={20} />,   label: t('nav_write') },
    { id: 'archive', path: '/archive', icon: <History size={20} />,   label: t('nav_notes') },
    { id: 'profile', path: '/profile', icon: <UserIcon size={20} />,  label: t('nav_profile') },
    ...(isAdmin ? [{ id: 'admin', path: '/admin', icon: <Shield size={20} className="text-red-400" />, label: t('nav_admin') }] : []),
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
        "h-full z-50 flex flex-col py-4 transition-all duration-300 ease-in-out",
        "bg-surface-card/50 border-r border-border-subtle backdrop-blur-xl",
        inGrid ? "relative w-full" : "fixed top-0 left-0",
        !inGrid && expanded && "w-[220px]",
        !inGrid && !expanded && "w-16",
        showZen && !inGrid && "opacity-0 pointer-events-none -translate-x-4"
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 mb-8 h-10 overflow-hidden">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-lg bg-text-main text-surface-base shrink-0">
          J
        </div>
        <span className={cn(
          "font-bold text-lg text-text-main whitespace-nowrap overflow-hidden transition-all duration-300",
          expanded ? "opacity-100 max-w-[160px] ml-0" : "opacity-0 max-w-0 ml-[-4px]"
        )}>
          justwriting
        </span>
      </div>

      {/* Nav items */}
      <nav
        className="flex-1 flex flex-col gap-1 px-2"
        role="menubar"
        onKeyDown={(e) => {
          const items = Array.from(e.currentTarget.querySelectorAll('[role="menuitem"]')) as HTMLElement[];
          const idx = items.indexOf(document.activeElement as HTMLElement);
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            const next = items[(idx + 1) % items.length];
            next?.focus();
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prev = items[(idx - 1 + items.length) % items.length];
            prev?.focus();
          }
          if (e.key === 'Escape') setExpanded(false);
        }}
      >
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => navigate(item.path)}
            role="menuitem"
            tabIndex={0}
            aria-current={location.pathname === item.path ? 'page' : undefined}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 text-left w-full overflow-hidden",
              location.pathname === item.path
                ? "bg-text-main text-surface-base"
                : "text-text-main/50 hover:text-text-main hover:bg-text-main/8"
            )}
          >
            <span className="shrink-0">{item.icon}</span>
            <span className={cn(
              "text-sm font-medium whitespace-nowrap overflow-hidden transition-all duration-300",
              expanded ? "opacity-100 max-w-[160px] ml-0" : "opacity-0 max-w-0 ml-[-4px]"
            )}>
              {item.label}
            </span>
          </button>
        ))}
        </nav>

      {/* Bottom section */}
      <div className="flex flex-col gap-1 px-2 mt-auto">
        <button
          onClick={() => navigate('/about')}
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 text-left w-full overflow-hidden",
            "text-text-main/40 hover:text-text-main/60 hover:bg-text-main/8"
          )}
          title={t('nav_about')}
        >
          <span className="shrink-0"><Info size={20} /></span>
          <span className={cn(
            "text-sm font-medium whitespace-nowrap overflow-hidden transition-all duration-300",
            expanded ? "opacity-100 max-w-[160px] ml-0" : "opacity-0 max-w-0 ml-[-4px]"
          )}>
            {t('nav_about')}
          </span>
        </button>

        {isGuest && (
          <button
            onClick={openLoginModal}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 text-left w-full overflow-hidden",
              "text-text-main/70 hover:text-text-main hover:bg-text-main/15"
            )}
            title={t('auth_sign_in')}
          >
            <span className="shrink-0"><LogIn size={20} /></span>
            <span className={cn(
              "text-sm font-medium whitespace-nowrap overflow-hidden transition-all duration-300",
              expanded ? "opacity-100 max-w-[160px] ml-0" : "opacity-0 max-w-0 ml-[-4px]"
            )}>
              {t('auth_sign_in')}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
