import { useNavigate, useLocation } from 'react-router-dom';
import { useLanguage } from '../../../shared/i18n';
import { cn } from '../../../core/utils/utils';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { useLoginModal } from '../../../app/useLoginModal';
import { Sparkles } from 'lucide-react';
import { Button } from '../../../shared/components/Button';
import { useSyncStatus } from '../../../core/sync/useSyncStatus';
import { useActivityLogStore } from '../../../shared/activity/useActivityLogStore';

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


/**
 * MR-4: четыре вкладки у всех. Пятой была «Диагностика» — на 320 px пять вкладок
 * давали 329 px и горизонтальный скролл; теперь она строка в «Профиле». Чипы
 * «Активность» и «Синхронизация» висели на 32 px над панелью и перекрывали
 * последнюю строку списка, композер и «Выйти» — их состояние стала показывать
 * точка на вкладке «Профиль».
 */
export function BottomNav() {
  const navigate = useNavigate();
  // Без этой подписки `location` ниже — глобальный window.location: подсветка
  // вкладки не пересчитывалась бы при переходах (T-1b это и сломал).
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
  const newestLevel = entries[0]?.level;
  const hasActivityAlert = newestLevel === 'error' || newestLevel === 'warning';
  const showAlertDot = showSyncIndicator || hasActivityAlert;

  const tabs = [
    { id: 'write' as const, path: '/',        label: t('nav_write'),          icon: <PenIcon /> },
    { id: 'archive' as const, path: '/archive', label: t('nav_notes_short'),  icon: <ArchiveIcon /> },
    { id: 'ai' as const, path: '/ai',          label: 'AI',                    icon: <Sparkles size={22} strokeWidth={1.6} aria-hidden="true" /> },
    { id: 'me' as const,   path: '/me',       label: t('nav_profile_short'),  icon: <MeIcon /> },
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
    if (isGuest && tab.id === 'ai') {
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
    <nav
      className="fixed bottom-0 left-0 right-0 z-[var(--z-sidebar)] bg-surface-card/85 backdrop-blur-xl border-t border-white/[0.06] flex justify-around pt-2 pb-safe"
      aria-label={t('nav_aria_label')}
    >
      {tabs.map(tab => {
        const active = isActive(tab);
        return (
          <Button
            key={tab.id}
            onClick={() => handleTabPress(tab)}
            aria-label={tab.label}
            aria-current={active ? 'page' : undefined}
            className={cn(
              "relative flex min-w-16 flex-col items-center gap-[3px] py-1 px-2 bg-transparent border-none cursor-pointer transition-colors duration-150",
              active ? "text-text-main font-semibold" : "text-text-main/60 hover:text-text-main",
              isGuest && tab.id === 'ai' ? "opacity-40" : ""
            )}
          >
            {tab.icon}
            {tab.id === 'me' && showAlertDot && (
              <span
                data-testid="tab-dot"
                aria-hidden="true"
                className="absolute top-0.5 right-[22%] w-2 h-2 rounded-full bg-accent-warning"
              />
            )}
            <span className="text-label-sm font-sans tracking-[0.02em]">
              {tab.label}
            </span>
          </Button>
        );
      })}
    </nav>
  );
}
