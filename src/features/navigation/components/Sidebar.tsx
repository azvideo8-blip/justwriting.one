import { useState, type ReactNode } from 'react';
import { PenLine, History, User as UserIcon, Shield, LogIn } from 'lucide-react';
import { motion, AnimatePresence, LayoutGroup } from 'motion/react';
import { useLanguage } from '../../../core/i18n';
import { cn } from '../../../core/utils/utils';
import { useLocation, useNavigate } from 'react-router-dom';
import { useWritingSettings } from '../../writing/contexts/WritingSettingsContext';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';
import { useLoginModal } from '../../auth/contexts/LoginModalContext';
import { JustWritingLogo } from '../../../shared/components/JustWritingLogo';
import { APP_VERSION } from '../../../version';
import { useLocalStorage } from '../../../shared/hooks/useLocalStorage';
import { z } from 'zod';

interface SidebarNavItemProps {
  icon: ReactNode;
  label: string;
  isActive: boolean;
  expanded: boolean;
  onClick: () => void;
}

function SidebarNavItem({ icon, label, isActive, expanded, onClick }: SidebarNavItemProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      tabIndex={0}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        "relative group flex items-center gap-3 rounded-xl transition-colors duration-200 text-left w-full overflow-hidden",
        "px-3 py-2.5 pl-[10px]",
        isActive
          ? "text-brand-soft"
          : "text-text-main/40 hover:text-text-main/70"
      )}
    >
      {isActive && (
        <motion.div
          layoutId="active-nav-indicator"
          className="absolute inset-0 bg-brand-soft/8 border-l-2 border-brand-soft rounded-xl"
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
        />
      )}
      <span className="relative z-10 shrink-0">{icon}</span>
      <span className={cn(
        "relative z-10 text-sm font-medium whitespace-nowrap overflow-hidden transition-all duration-300",
        expanded ? "opacity-100 max-w-[160px] ml-0" : "opacity-0 max-w-0 ml-[-4px]"
      )}>
        {label}
      </span>
      {!expanded && (
        <AnimatePresence>
          {hovered && (
            <motion.span
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              transition={{ duration: 0.15 }}
              className="pointer-events-none absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap z-50 bg-surface-card border border-border-subtle text-text-main shadow-lg"
            >
              {label}
            </motion.span>
          )}
        </AnimatePresence>
      )}
    </button>
  );
}

interface SidebarActionItemProps {
  icon: ReactNode;
  label: string;
  expanded: boolean;
  onClick: () => void;
  accent?: boolean;
}

function SidebarActionItem({ icon, label, expanded, onClick, accent }: SidebarActionItemProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      className={cn(
        "relative group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 text-left w-full overflow-hidden",
        accent
          ? "text-text-main/70 hover:text-text-main hover:bg-text-main/25"
          : "text-text-main/40 hover:text-text-main/60 hover:bg-text-main/8"
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className={cn(
        "text-sm font-medium whitespace-nowrap overflow-hidden transition-all duration-300",
        expanded ? "opacity-100 max-w-[160px] ml-0" : "opacity-0 max-w-0 ml-[-4px]"
      )}>
        {label}
      </span>
      {!expanded && (
        <AnimatePresence>
          {hovered && (
            <motion.span
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              transition={{ duration: 0.15 }}
              className="pointer-events-none absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap z-50 bg-surface-card border border-border-subtle text-text-main shadow-lg"
            >
              {label}
            </motion.span>
          )}
        </AnimatePresence>
      )}
    </button>
  );
}

interface SidebarProps {
  isAdmin: boolean;
  inGrid?: boolean;
}

export function Sidebar({ isAdmin, inGrid: inGridProp }: SidebarProps) {
  const [pinned, setPinned] = useLocalStorage<boolean>('sidebar_pinned', false, z.boolean());
  const [hovered, setHovered] = useState(false);
  const { t } = useLanguage();
  const { lifeLogEnabled: _lifeLogEnabled, isZenActive, zenModeEnabled } = useWritingSettings();
  const showZen = isZenActive && zenModeEnabled;
  const inGrid = inGridProp ?? false;
  const location = useLocation();
  const navigate = useNavigate();
  const { isGuest } = useAuthStatus();
  const { openLoginModal } = useLoginModal();
  const isWritePage = location.pathname === '/';
  const expanded = isWritePage ? hovered : (pinned || hovered);

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
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
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
        <JustWritingLogo size={36} variant="dark" showRailway={true} showRoman={false} showCrown={true} className="shrink-0" />
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
        onKeyDown={(e) => {
          const items = Array.from(e.currentTarget.querySelectorAll('button[tabindex="0"]')) as HTMLElement[];
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
        }}
      >
        <LayoutGroup>
        {navItems.map(item => (
          <SidebarNavItem
            key={item.id}
            icon={item.icon}
            label={item.label}
            isActive={location.pathname === item.path}
            expanded={expanded}
            onClick={() => navigate(item.path)}
          />
        ))}
        </LayoutGroup>
      </nav>

      {/* Bottom section */}
      <div className="flex flex-col gap-1 px-2 mt-auto">
        {isGuest && (
          <SidebarActionItem
            icon={<LogIn size={20} />}
            label={t('auth_sign_in')}
            expanded={expanded}
            onClick={openLoginModal}
            accent
          />
        )}

        {!isWritePage && (
        <button
          onClick={() => setPinned(!pinned)}
          title={pinned ? t('sidebar_unpin') : t('sidebar_pin')}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2 rounded-xl text-text-main/25 hover:text-text-main/50 transition-colors",
            expanded ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
            {pinned
              ? <path d="M7 2v10M4 5h6M4 9h6" strokeLinecap="round"/>
              : <path d="M5 2l4 4-6 6M9 2l-4 4 6 6" strokeLinecap="round"/>
            }
          </svg>
          <span className="text-label font-mono uppercase tracking-widest">
            {pinned ? t('sidebar_unpin') : t('sidebar_pin')}
          </span>
        </button>
        )}

        <div className={cn(
          "px-3 py-2 text-label font-mono text-text-main/25 transition-all duration-300 select-none whitespace-nowrap flex items-center gap-2",
          expanded ? "opacity-100 pl-3" : "opacity-0 h-0 p-0 overflow-hidden"
        )}>
          <span>{t('common_version')}: {APP_VERSION}</span>
          <span className="text-text-main/25">·</span>
          <button
            onClick={() => navigate('/about')}
            className="hover:text-text-main/50 transition-colors underline underline-offset-2 decoration-dotted"
          >
            {t('nav_about')}
          </button>
        </div>
      </div>
    </div>
  );
}
