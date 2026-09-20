import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useLanguage } from '../../../shared/i18n';
import { cn } from '../../../core/utils/utils';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { useLoginModal } from '../../../app/useLoginModal';
import { Shield, Sparkles, Activity, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '../../../shared/components/Button';
import { useSyncStatus } from '../../../core/sync/useSyncStatus';
import { useActivityLogStore } from '../../../shared/activity/useActivityLogStore';

const RECENT_ACTIVITY_MS = 10_000;

const PenIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
    <path d="M12 20h9"/>
    <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/>
  </svg>
);
const MeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
    <circle cx="12" cy="8" r="4"/>
    <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>
  </svg>
);

const ArchiveIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
    <rect width="20" height="5" x="2" y="3" rx="1" />
    <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
    <line x1="10" y1="12" x2="14" y2="12" />
  </svg>
);


interface BottomNavProps {
  isAdmin: boolean;
}

export function BottomNav({ isAdmin }: BottomNavProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();
  const { isGuest, user } = useAuthStatus();
  const { openLoginModal } = useLoginModal();
  const syncStatus = useSyncStatus(user?.uid ?? null);
  // Guests have no cloud sync relationship at all, so isCloudConnected
  // staying false for them isn't a "cloud unavailable" problem — gate on
  // being an actual authenticated user, same as AppTab's settings row.
  // Значок показывается и при выключенной автоотправке: незалитые заметки —
  // повод сказать об этом, а не молчать, потому что отправка выключена.
  const showSyncIndicator = !isGuest
    && syncStatus.status !== 'synced'
    && syncStatus.status !== 'sync_off';

  const entries = useActivityLogStore(s => s.entries);
  const openActivityPanel = useActivityLogStore(s => s.setPanelOpen);
  const newestLevel = entries[0]?.level;
  const isNewestError = newestLevel === 'error';
  const errorCount = entries.filter(e => e.level === 'error').length;
  const mostRecentTime = entries[0]?.time;

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

  const tabs = [
    { id: 'write' as const, path: '/',        label: t('nav_write'),          icon: <PenIcon /> },
    { id: 'archive' as const, path: '/archive', label: t('nav_notes_short'),  icon: <ArchiveIcon /> },
    { id: 'ai' as const, path: '/ai',          label: 'AI',                    icon: <Sparkles size={22} strokeWidth={1.6} aria-hidden="true" /> },
    { id: 'me' as const,   path: '/me',       label: t('nav_profile_short'),  icon: <MeIcon /> },
    ...(isAdmin ? [{ id: 'diagnostics' as const, path: '/diagnostics', label: t('admin_tab_diagnostics') || 'Диагностика', icon: <Shield size={22} strokeWidth={1.6} aria-hidden="true" /> } as const] : []),
  ];

  type Tab = typeof tabs[number];

  const handleTabPress = (tab: Tab) => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(8);
      } catch {
        // ignore
      }
    }
    // If guest taps auth-required tab — open login modal
    if (isGuest && (tab.id === 'ai' || tab.id === 'diagnostics')) {
      openLoginModal();
      return;
    }
    void navigate(tab.path);
  };

  const isActive = (tab: Tab) => {
    if (tab.id === 'write') return location.pathname === '/';
    return location.pathname === tab.path;
  };

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 bg-surface-card/85 backdrop-blur-xl border-t border-white/[0.06] flex justify-around pt-2 pb-safe"
    >
      <button
        type="button"
        onClick={() => openActivityPanel(true)}
        aria-label="Журнал активности"
        className={cn(
          "absolute -top-8 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium backdrop-blur-md transition-colors",
          isNewestError
            ? "bg-accent-danger/15 border border-accent-danger/30 text-accent-danger"
            : (newestLevel === 'success' || isRecent)
              ? "bg-accent-success/15 border border-accent-success/30 text-accent-success"
              : "bg-surface-card/80 border border-border-subtle text-text-main/60 hover:text-text-main"
        )}
        title={isNewestError ? `${errorCount} ${errorCount === 1 ? 'ошибка' : errorCount < 5 ? 'ошибки' : 'ошибок'}` : (newestLevel === 'success' || isRecent) ? 'Активность' : 'Журнал'}
      >
        {isNewestError ? (
          <AlertCircle size={14} className="shrink-0" />
        ) : (newestLevel === 'success' || isRecent) ? (
          <CheckCircle2 size={14} className="shrink-0" />
        ) : (
          <Activity size={14} className="shrink-0" />
        )}
        <span>
          {isNewestError ? `${errorCount} ${errorCount === 1 ? 'ошибка' : errorCount < 5 ? 'ошибки' : 'ошибок'}` : (newestLevel === 'success' || isRecent) ? 'Активность' : 'Журнал'}
        </span>
      </button>
      {showSyncIndicator && (
        <button
          onClick={() => void navigate('/settings')}
          className="absolute -top-8 right-3 flex items-center gap-1.5 px-2 py-1 rounded-full bg-accent-warning/15 border border-accent-warning/30 text-accent-warning text-xs font-medium"
          title={t(
            syncStatus.status === 'offline' ? 'sync_paused_no_network'
              : syncStatus.status === 'cloud_unavailable' ? 'sync_paused_cloud_unavailable'
              : 'sync_paused_pending',
            syncStatus.status === 'pending' ? { count: String(syncStatus.pendingCount) } : undefined
          )}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-accent-warning animate-pulse" />
          {t('sync_indicator_label')}
        </button>
      )}
      {tabs.map(tab => {
        const active = isActive(tab);
        return (
          <Button
            key={tab.id}
            onClick={() => handleTabPress(tab)}
            aria-label={tab.label}
            aria-current={active ? 'page' : undefined}
            className={cn(
              "flex flex-col items-center gap-[3px] py-1 px-2 bg-transparent border-none cursor-pointer transition-colors duration-150",
              active ? "text-text-main font-semibold" : "text-text-main/60 hover:text-text-main/60",
              isGuest && ['ai'].includes(tab.id) ? "opacity-40" : ""
            )}
          >
            {tab.icon}
            <span className="text-label-sm font-sans tracking-[0.02em]">
              {tab.label}
            </span>
          </Button>
        );
      })}
    </div>
  );
}
