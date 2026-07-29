import { useState, useEffect, type ReactNode } from 'react';
import { PenLine, History, User as UserIcon, LogIn, Settings, Sparkles, Bug, CloudOff, AlertCircle, CheckCircle2, Activity } from 'lucide-react';
import { motion, AnimatePresence, LayoutGroup } from 'motion/react';
import { useLanguage } from '../../../shared/i18n';
import { cn } from '../../../core/utils/utils';
import { useLocation, useNavigate } from 'react-router-dom';
import { useWritingSettings } from '../../writing/contexts/WritingSettingsContext';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { useLoginModal } from '../../../app/useLoginModal';
import { JustWritingLogo } from '../../../shared/components/JustWritingLogo';
import { APP_VERSION } from '../../../version';
import { useSyncStatus } from '../../settings/hooks/useSyncStatus';
import { useActivityLogStore } from '../../../shared/activity/useActivityLogStore';

/** How long after the newest entry the badge stays green. */
const RECENT_ACTIVITY_MS = 10_000;

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
        "px-3 py-3 pl-[10px]",
        isActive
          ? "text-brand-soft"
          : "text-text-main/60 hover:text-text-main/70"
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
        "relative z-10 text-sm font-medium whitespace-nowrap overflow-hidden transition-[opacity,max-width,margin-left] duration-300",
        expanded ? "opacity-100 max-w-[160px] ml-0" : "opacity-0 max-w-0 ml-[-4px]"
      )}>
        {label}
      </span>
      {!expanded && (
        <AnimatePresence>
          {hovered && (
            <motion.span
              initial={{ opacity: 0, transform: "translateX(-6px) translateY(-50%)" }}
              animate={{ opacity: 1, transform: "translateX(0px) translateY(-50%)" }}
              exit={{ opacity: 0, transform: "translateX(-6px) translateY(-50%)" }}
              transition={{ duration: 0.15 }}
              className="pointer-events-none absolute left-full ml-3 top-1/2 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap z-50 bg-surface-card border border-border-subtle text-text-main shadow-lg"
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
        "relative group flex items-center gap-3 px-3 py-3 rounded-xl transition-colors duration-200 text-left w-full overflow-hidden",
        accent
          ? "text-text-main/70 hover:text-text-main hover:bg-text-main/25"
          : "text-text-main/60 hover:text-text-main/60 hover:bg-text-main/8"
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className={cn(
        "text-sm font-medium whitespace-nowrap overflow-hidden transition-[opacity,max-width,margin-left] duration-300",
        expanded ? "opacity-100 max-w-[160px] ml-0" : "opacity-0 max-w-0 ml-[-4px]"
      )}>
        {label}
      </span>
      {!expanded && (
        <AnimatePresence>
          {hovered && (
            <motion.span
              initial={{ opacity: 0, transform: "translateX(-6px) translateY(-50%)" }}
              animate={{ opacity: 1, transform: "translateX(0px) translateY(-50%)" }}
              exit={{ opacity: 0, transform: "translateX(-6px) translateY(-50%)" }}
              transition={{ duration: 0.15 }}
              className="pointer-events-none absolute left-full ml-3 top-1/2 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap z-50 bg-surface-card border border-border-subtle text-text-main shadow-lg"
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
  onOpenSettings: () => void;
}

export function Sidebar({ isAdmin, onOpenSettings }: SidebarProps) {
  const [hovered, setHovered] = useState(false);
  const { t } = useLanguage();
  const { lifeLogEnabled: _lifeLogEnabled, isZenActive, zenModeEnabled } = useWritingSettings();
  const showZen = isZenActive && zenModeEnabled;
  const location = useLocation();
  const navigate = useNavigate();
  const { isGuest, user } = useAuthStatus();
  const { openLoginModal } = useLoginModal();
  const expanded = hovered;
  const syncStatus = useSyncStatus(user?.uid ?? null);
  
  const entries = useActivityLogStore(s => s.entries);
  const openActivityPanel = useActivityLogStore(s => s.setPanelOpen);
  const errorCount = entries.filter(e => e.level === 'error').length;
  const mostRecentTime = entries[0]?.time;

  // Driven by a timer, not by Date.now() during render: read at render time the
  // green state only re-evaluates when something unrelated re-renders the
  // sidebar, so the badge would sit green long after the work finished.
  // Both transitions happen inside timers so the effect never calls setState
  // synchronously; the "on" tick is imperceptible.
  const [isRecent, setIsRecent] = useState(false);
  useEffect(() => {
    const elapsed = mostRecentTime === undefined ? Infinity : Date.now() - mostRecentTime;
    if (elapsed >= RECENT_ACTIVITY_MS) {
      const off = setTimeout(() => setIsRecent(false), 0);
      return () => clearTimeout(off);
    }
    const on = setTimeout(() => setIsRecent(true), 0);
    const off = setTimeout(() => setIsRecent(false), RECENT_ACTIVITY_MS - elapsed);
    return () => { clearTimeout(on); clearTimeout(off); };
  }, [mostRecentTime]);

  // Guests have no cloud sync relationship at all, so isFirestoreConnected
  // staying false for them isn't a "cloud unavailable" problem — gate on
  // being an actual authenticated user, same as AppTab's settings row.
  const showSyncIndicator = !isGuest && syncStatus.autoSyncEnabled && syncStatus.status !== 'synced';

  const navItems = [
    { id: 'write',   path: '/',       icon: <PenLine size={20} />,   label: t('nav_write') },
    { id: 'archive', path: '/archive', icon: <History size={20} />,   label: t('nav_notes') },
    { id: 'ai',      path: '/ai',     icon: <Sparkles size={20} />,  label: 'AI' },
    { id: 'profile', path: '/profile', icon: <UserIcon size={20} />,  label: t('nav_profile') },
    ...(isAdmin ? [{ id: 'diagnostics', path: '/diagnostics', icon: <Bug size={20} className="text-accent-danger" />, label: 'Диагностика' }] : []),
  ];

  return (
    <div
      role="navigation"
      aria-label={t('nav_main')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
          "h-full z-50 flex flex-col py-4 sidebar-transition",
          "fixed top-0 left-0 border-r border-border-subtle backdrop-blur-xl",
          expanded && "w-[220px]",
          !expanded && "w-16",
          showZen && "opacity-0 pointer-events-none -translate-x-4"
        )}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 mb-8 h-10 overflow-hidden">
        <JustWritingLogo size={36} variant="dark" showRailway={true} showRoman={false} showCrown={true} className="shrink-0" />
        <span className={cn(
          "font-bold text-lg text-text-main whitespace-nowrap overflow-hidden transition-[opacity,max-width,margin-left] duration-300",
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
            onClick={() => void navigate(item.path)}
          />
        ))}
        </LayoutGroup>
      </nav>

      {/* Bottom section */}
      <div className="flex flex-col gap-1 px-2 mt-auto">
        {showSyncIndicator && (
          <button
            onClick={() => void navigate('/settings')}
            className={cn(
              "relative flex items-center gap-3 rounded-xl transition-colors duration-200 text-left w-full overflow-hidden px-3 py-2",
              "text-amber-400/80 hover:text-amber-400"
            )}
            title={t(
              syncStatus.status === 'offline' ? 'sync_paused_no_network'
                : syncStatus.status === 'cloud_unavailable' ? 'sync_paused_cloud_unavailable'
                : 'sync_paused_pending',
              syncStatus.status === 'pending' ? { count: String(syncStatus.pendingCount) } : undefined
            )}
          >
            <CloudOff size={18} className="shrink-0 animate-pulse" />
            <span className={cn(
              "text-xs font-medium whitespace-nowrap overflow-hidden transition-[opacity,max-width,margin-left] duration-300",
              expanded ? "opacity-100 max-w-[160px] ml-0" : "opacity-0 max-w-0 ml-[-4px]"
            )}>
              {t(
                syncStatus.status === 'offline' ? 'sync_paused_no_network'
                  : syncStatus.status === 'cloud_unavailable' ? 'sync_paused_cloud_unavailable'
                  : 'sync_paused_pending',
                syncStatus.status === 'pending' ? { count: String(syncStatus.pendingCount) } : undefined
              )}
            </span>
            {!expanded && (
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            )}
          </button>
        )}

        {entries.length > 0 && (() => {
          let badgeColor = "text-text-main/60 hover:text-text-main";
          let badgeBg = "hover:bg-surface-elevated";
          let icon = <Activity size={18} className="shrink-0" />;
          let label = "Журнал";
          let dotColor = "";
          let dotText = "";

          if (errorCount > 0) {
            badgeColor = "text-accent-danger/80 hover:text-accent-danger";
            badgeBg = "hover:bg-accent-danger/10";
            icon = <AlertCircle size={18} className="shrink-0" />;
            label = `${errorCount} ${errorCount === 1 ? 'ошибка' : errorCount < 5 ? 'ошибки' : 'ошибок'}`;
            dotColor = "bg-accent-danger text-surface-card";
            dotText = errorCount > 9 ? '9+' : String(errorCount);
          } else if (isRecent) {
            badgeColor = "text-accent-success/80 hover:text-accent-success";
            badgeBg = "hover:bg-accent-success/10";
            icon = <CheckCircle2 size={18} className="shrink-0" />;
            label = "Активность";
            dotColor = "bg-accent-success";
          }

          return (
            <button
              onClick={() => openActivityPanel(true)}
              className={cn(
                "relative flex items-center gap-3 rounded-xl transition-colors duration-200 text-left w-full overflow-hidden px-3 py-2",
                badgeColor, badgeBg
              )}
              title={label}
            >
              {icon}
              <span className={cn(
                "text-xs font-medium whitespace-nowrap overflow-hidden transition-[opacity,max-width,margin-left] duration-300",
                expanded ? "opacity-100 max-w-[160px] ml-0" : "opacity-0 max-w-0 ml-[-4px]"
              )}>
                {label}
              </span>
              {!expanded && dotColor && (
                <span className={cn(
                  "absolute top-1 right-1 min-w-[14px] h-[14px] px-1 rounded-full text-[9px] font-bold flex items-center justify-center",
                  dotColor
                )}>
                  {dotText}
                </span>
              )}
            </button>
          );
        })()}

        {isGuest && (
        <SidebarActionItem
          icon={<LogIn size={20} />}
          label={t('auth_sign_in')}
          expanded={expanded}
          onClick={() => void openLoginModal()}
          accent
        />
        )}

        <SidebarActionItem
          icon={<Settings size={20} />}
          label={t('nav_settings')}
          expanded={expanded}
          onClick={() => void onOpenSettings()}
        />

        <div className={cn(
          "px-3 py-2 text-[9px] font-mono text-text-main/60 transition-[opacity,height,padding] duration-300 select-none whitespace-nowrap flex flex-col items-start gap-1.5",
          expanded ? "opacity-100 pl-3" : "opacity-0 h-0 p-0 overflow-hidden"
        )}>
          <button
            onClick={() => void navigate('/about')}
            className="hover:text-text-main/60 transition-colors underline underline-offset-2 decoration-dotted"
          >
            {t('nav_about')}
          </button>
          <button
            type="button"
            onClick={() => void navigate('/changelog')}
            className="hover:text-text-main/60 transition-colors"
          >
            v{APP_VERSION}
          </button>
        </div>
      </div>
    </div>
  );
}
