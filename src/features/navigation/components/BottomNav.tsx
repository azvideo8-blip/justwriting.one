import { useNavigate, useLocation } from 'react-router-dom';
import { useLanguage } from '../../../core/i18n';
import { cn } from '../../../core/utils/utils';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';
import { useLoginModal } from '../../auth/contexts/LoginModalContext';
import { Shield } from 'lucide-react';

const PenIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
    <path d="M12 20h9"/>
    <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/>
  </svg>
);
const LogIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
    <circle cx="12" cy="12" r="9"/>
    <path d="M12 7v5l3 2"/>
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
  const { isGuest } = useAuthStatus();
  const { openLoginModal } = useLoginModal();

  const tabs = [
    { id: 'write' as const, path: '/',       label: t('nav_write'), icon: <PenIcon /> },
    { id: 'log' as const,  path: '/log',     label: t('lifelog_tab_log'), icon: <LogIcon /> },
    { id: 'archive' as const, path: '/archive', label: t('archive_sidebar_title'), icon: <ArchiveIcon /> },
    { id: 'me' as const,   path: '/me',      label: t('nav_me'),    icon: <MeIcon /> },
    ...(isAdmin ? [{ id: 'admin' as const, path: '/admin', label: t('nav_admin'), icon: <Shield size={22} strokeWidth={1.6} /> } as const] : []),
  ];

  type Tab = typeof tabs[number];

  const handleTabPress = (tab: Tab) => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(8);
      } catch {
        // ignore
      }
    }
    // If guest taps auth-required tab — open login modal
    if (isGuest && (tab.id === 'archive' || tab.id === 'me' || tab.id === 'admin')) {
      openLoginModal();
      return;
    }
    navigate(tab.path);
  };

  const isActive = (tab: Tab) => {
    if (tab.id === 'write') return location.pathname === '/';
    return location.pathname === tab.path;
  };

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 bg-surface-card/85 backdrop-blur-xl border-t border-white/[0.06] flex justify-around pt-2"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 16px)' }}
    >
      {tabs.map(tab => {
        const active = isActive(tab);
        return (
          <button
            key={tab.id}
            onClick={() => handleTabPress(tab)}
            aria-label={tab.label}
            aria-current={active ? 'page' : undefined}
            className={cn(
              "flex flex-col items-center gap-[3px] py-1 px-2 bg-transparent border-none cursor-pointer transition-colors duration-150",
              active ? "text-text-main font-semibold" : "text-text-main/30 hover:text-text-main/60",
              isGuest && ['archive', 'me'].includes(tab.id) ? "opacity-40" : ""
            )}
          >
            {tab.icon}
            <span className="text-[11px] font-sans tracking-[0.02em]">
              {tab.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
