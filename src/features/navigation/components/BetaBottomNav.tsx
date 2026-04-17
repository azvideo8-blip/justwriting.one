import { PenLine, History, User as UserIcon, Globe, Shield, PanelRight, Settings } from 'lucide-react';
import { useLanguage } from '../../../core/i18n';
import { cn } from '../../../core/utils/utils';
import { useLocation, useNavigate } from 'react-router-dom';
import { useWritingSettings } from '../../writing/contexts/WritingSettingsContext';
import { useSettings } from '../../../core/settings/SettingsContext';
import { User } from 'firebase/auth';

interface BetaBottomNavProps {
  isAdmin: boolean;
  user?: User | null;
  onOpenLifeLog?: () => void;
}

export function BetaBottomNav({ isAdmin, onOpenLifeLog }: BetaBottomNavProps) {
  const { t } = useLanguage();
  const { betaLifeLog, lifeLogVisible, lifeLogTab, setLifeLogVisible, setLifeLogTab } = useWritingSettings();
  const { openSettings } = useSettings();
  const location = useLocation();
  const navigate = useNavigate();

  const navItems = [
    { id: 'write',    path: '/',        icon: <PenLine size={20} />,  label: t('nav_write_short') },
    { id: 'archive',  path: '/archive', icon: <History size={20} />,  label: t('nav_notes_short') },
    { id: 'profile',  path: '/profile', icon: <UserIcon size={20} />, label: t('nav_profile_short') },
    { id: 'feed',     path: '/feed',    icon: <Globe size={20} />,    label: t('nav_community_short') },
    ...(isAdmin ? [{ id: 'admin', path: '/admin', icon: <Shield size={20} className="text-red-400" />, label: t('nav_admin') }] : []),
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-surface-card border-t border-border-subtle backdrop-blur-xl pb-4">
      <div className="flex items-center px-2 py-2 gap-1">
        <div className="flex items-center justify-between w-full gap-1">
          {navItems.map(item => {
            const isActive = location.pathname === item.path;
            return (
              <button
                key={item.id}
                onClick={() => navigate(item.path)}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 p-2.5 rounded-2xl transition-all duration-200 min-w-[48px]",
                  isActive
                    ? "text-text-main"
                    : "text-text-main/50 hover:text-text-main"
                )}
              >
                {item.icon}
                <div className={cn(
                  "w-1 h-1 rounded-full transition-all duration-200",
                  isActive ? "bg-text-main" : "bg-transparent"
                )} />
              </button>
            );
          })}

          {betaLifeLog && (
            <button
              onClick={() => {
                if (!lifeLogVisible || lifeLogTab !== 'log') {
                  setLifeLogTab('log');
                  setLifeLogVisible(true);
                } else {
                  setLifeLogVisible(false);
                }
              }}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 p-2.5 rounded-2xl transition-all duration-200 min-w-[48px]",
                lifeLogVisible && lifeLogTab === 'log'
                  ? "text-text-main"
                  : "text-text-main/50 hover:text-text-main"
              )}
              aria-label={t('lifelog_tab_log')}
            >
              <PanelRight size={20} />
              <div className={cn(
                "w-1 h-1 rounded-full transition-all duration-200",
                lifeLogVisible && lifeLogTab === 'log' ? "bg-text-main" : "bg-transparent"
              )} />
            </button>
          )}

          {!betaLifeLog && (
            <button
              onClick={openSettings}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 p-2.5 rounded-2xl transition-all duration-200 min-w-[48px]",
                "text-text-main/50 hover:text-text-main"
              )}
              aria-label={t('nav_settings')}
            >
              <Settings size={20} />
              <div className="w-1 h-1 rounded-full bg-transparent" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
