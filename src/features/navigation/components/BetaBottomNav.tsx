import { useNavigate, useLocation } from 'react-router-dom';
import { useLanguage } from '../../../core/i18n';
import { useWritingSettings } from '../../writing/contexts/WritingSettingsContext';
import { cn } from '../../../core/utils/utils';

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

interface BetaBottomNavProps {
  isAdmin: boolean;
  onOpenLifeLog?: () => void;
}

export function BetaBottomNav({ onOpenLifeLog }: BetaBottomNavProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();
  const { lifeLogVisible, lifeLogTab, setLifeLogVisible, setLifeLogTab } = useWritingSettings();

  const tabs = [
    { id: 'write' as const, path: '/',   label: t('nav_write'), icon: <PenIcon /> },
    { id: 'log' as const,  path: '/log', label: 'Log',          icon: <LogIcon /> },
    { id: 'me' as const,   path: '/profile', label: t('nav_me'), icon: <MeIcon /> },
  ];

  type Tab = typeof tabs[number];

  const handleTabPress = (tab: Tab) => {
    if (tab.id === 'log') {
      navigate('/');
      if (!lifeLogVisible || lifeLogTab !== 'log') {
        setLifeLogTab('log');
        setLifeLogVisible(true);
      }
      onOpenLifeLog?.();
    } else {
      navigate(tab.path);
    }
  };

  const isActive = (tab: Tab) => {
    if (tab.id === 'log') return lifeLogVisible && lifeLogTab === 'log';
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
              "flex flex-col items-center gap-[3px] py-1 px-6 bg-transparent border-none cursor-pointer transition-colors duration-150",
              active ? "text-text-main" : "text-text-main/30 hover:text-text-main/60"
            )}
          >
            {tab.icon}
            <span className="text-[10px] font-sans tracking-[0.02em]">
              {tab.label}
            </span>
            {active && (
              <div className="w-1 h-1 rounded-full bg-current mt-0.5" />
            )}
          </button>
        );
      })}
    </div>
  );
}
