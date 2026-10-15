import React from 'react';
import type { AppUser } from '../../core/auth/types';
import { cn } from '../../core/utils/utils';
import { useLanguage } from '../../shared/i18n';
import { SettingRow } from '../../shared/components/MeScreenHelpers';
import { useSettings } from '../../core/settings/SettingsContext';
import { Button } from '../../shared/components/Button';
import { useLayoutMode } from '../../shared/hooks/useLayoutMode';
import { useNavigate } from 'react-router-dom';

interface MeAccountSectionProps {
  user: AppUser | null;
  onSignOut: () => void;
  onSignIn: () => void;
}

export function MeAccountSection({ user, onSignOut, onSignIn }: MeAccountSectionProps) {
  const { t, language, setLanguage } = useLanguage();
  const isGuest = !user;

  const { openSettings } = useSettings();
  const { layoutMode } = useLayoutMode();
  const navigate = useNavigate();
  // MF-9: на телефоне строка «Настройки» ведёт в настройки приложения, а не в
  // панель редактора; десктоп сохраняет панель.
  const openAppSettings = () => (layoutMode === 'mobile' ? void navigate('/settings') : openSettings());

  return (
    <div>
      <SettingRow label={t('settings_language')}>
        <div className="flex bg-text-main/[0.05] rounded-lg p-0.5 gap-0.5">
          {(['ru', 'en'] as const).map(lang => (
            <Button
              type="button"
              key={lang}
              variant="ghost"
              size="sm"
              onClick={() => setLanguage(lang)}
              className={cn(
                "min-w-11 min-h-11 px-3 py-1 rounded-md border-none cursor-pointer text-xs font-medium",
                language === lang
                  ? "bg-text-main/[0.1] text-text-main"
                  : "bg-transparent text-text-main/50"
              )}
            >
              {lang.toUpperCase()}
            </Button>
          ))}
        </div>
      </SettingRow>

      <SettingRow label={t('settings_title')} hint={t('settings_more_options')}>
        <Button
          variant="secondary"
          size="sm"
          onClick={openAppSettings}
          className="min-h-11 text-xs px-3 py-1.5"
        >
          {t('settings_open_panel')}
        </Button>
      </SettingRow>

      <SettingRow
        label={t('me_account_status')}
        hint={isGuest ? t('me_guest_desc') : (user?.email || undefined)}
      >
        {isGuest ? (
          <Button
            variant="primary"
            size="sm"
            onClick={onSignIn}
            className="min-h-11 text-xs font-semibold px-4 py-1.5 rounded-lg"
          >
            {t('nav_login')}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={onSignOut}
            className="min-h-11 text-xs text-accent-danger/70 hover:text-accent-danger px-3 py-1.5"
          >
            {t('nav_logout')}
          </Button>
        )}
      </SettingRow>
    </div>
  );
}
