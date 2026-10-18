import { useNavigate, useLocation } from 'react-router-dom';
import { useLanguage } from '../../../shared/i18n';
import { cn } from '../../../core/utils/utils';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { useLoginModal } from '../../../app/useLoginModal';
import { History, LogIn, Sparkles } from 'lucide-react';
import { Button } from '../../../shared/components/Button';
import { useSyncStatus } from '../../../core/sync/useSyncStatus';
import { useActivityLogStore } from '../../../shared/activity/useActivityLogStore';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { useKeyboardState } from '../../../shared/hooks/useKeyboardState';
import { useReducedMotion } from 'motion/react';

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

  // MC-2: на письме и в чате поднятая клавиатура забирает нижнюю панель — она
  // встанет над клавиатурой и съест строки текста. На остальных экранах панель
  // остаётся (поле поиска в «Заметках» — отложено по решению владельца).
  const { layoutMode } = useLayoutMode();
  const keyboard = useKeyboardState();
  const reducedMotion = useReducedMotion();
  const hidesForKeyboard = layoutMode === 'mobile' && keyboard.up
    && (location.pathname === '/' || location.pathname === '/ai');

  const baseTabs = [
    { id: 'write' as const, path: '/',        label: t('nav_write'),          icon: <PenIcon /> },
    // U-29 (решение владельца 2026-10-18): значок вкладки «Заметки» — `History`,
    // как в боковой панели десктопа; самописный «архивный ящик» убран.
    { id: 'archive' as const, path: '/archive', label: t('nav_notes_short'),  icon: <History size={22} strokeWidth={1.6} aria-hidden="true" /> },
    // N-2 (решение владельца 2026-10-18): у гостя вкладки «ИИ» нет — раньше она
    // стояла приглушённой и вела в модалку входа; вместо неё справа «Войти».
    ...(isGuest ? [] : [{ id: 'ai' as const, path: '/ai', label: t('nav_ai_short'), icon: <Sparkles size={22} strokeWidth={1.6} aria-hidden="true" /> }]),
    { id: 'me' as const,   path: '/me',       label: t('nav_profile_short'),  icon: <MeIcon /> },
  ];
  const tabs = isGuest
    ? [...baseTabs, { id: 'login' as const, path: null, label: t('nav_login'), icon: <LogIn size={22} strokeWidth={1.6} aria-hidden="true" /> }]
    : baseTabs;

  type Tab = typeof tabs[number];

  const handleTabPress = (tab: Tab) => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(8);
      } catch {
        // ignore
      }
    }
    // «Войти» открывает ту же модалку входа, что десктоп и «Профиль» гостя,
    // и не ведёт ни на какую страницу (N-2).
    if (tab.id === 'login') {
      openLoginModal();
      return;
    }
    void navigate(tab.path!);
  };

  const isActive = (tab: Tab) => {
    if (tab.path === null) return false;
    if (tab.id === 'write') return location.pathname === '/';
    return location.pathname === tab.path;
  };

  return (
    <nav
      data-testid="mobile-bottom-nav"
      className={cn(
        'fixed bottom-0 left-0 right-0 z-[var(--z-sidebar)] bg-surface-popup border-t border-border-subtle flex justify-around pt-2 pb-safe',
        hidesForKeyboard && 'translate-y-full',
      )}
      style={{
        // SA-8: `translate-y-full` в Tailwind v4 меняет свойство `translate`, не `transform` —
        // переход по `transform` его не видел, и панель прыгала.
        transitionProperty: 'translate',
        transitionDuration: reducedMotion ? '0s' : '180ms',
        transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
      }}
      aria-label={t('nav_aria_label')}
      aria-hidden={hidesForKeyboard ? true : undefined}
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
              // U-35 (решение владельца 2026-10-18, Q-6): активная вкладка — плашка-инверсия,
              // как активный пункт `Sidebar`, а не только жирная подпись.
              "relative flex min-w-16 flex-col items-center gap-[3px] py-1 px-2 rounded-xl bg-transparent border-none cursor-pointer transition-colors duration-150",
              active ? "text-surface-base font-semibold" : "text-text-main/60 hover:text-text-main"
            )}
          >
            {active && (
              <span aria-hidden="true" className="absolute inset-0 rounded-xl bg-text-main" />
            )}
            <span className="relative z-10 flex items-center justify-center">{tab.icon}</span>
            {tab.id === 'me' && showAlertDot && (
              <span
                data-testid="tab-dot"
                aria-hidden="true"
                className={cn("absolute top-0.5 right-[22%] z-10 w-2 h-2 rounded-full", newestLevel === 'error' ? "bg-accent-danger" : "bg-accent-warning")}
              />
            )}
            <span className="relative z-10 text-label-sm font-sans tracking-[0.02em]">
              {tab.label}
            </span>
          </Button>
        );
      })}
    </nav>
  );
}
