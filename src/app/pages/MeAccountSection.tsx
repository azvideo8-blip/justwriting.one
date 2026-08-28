import React from 'react';
import type { AppUser } from '../../core/auth/types';
import { cn } from '../../core/utils/utils';
import { useLanguage } from '../../shared/i18n';
import { SettingRow } from '../../shared/components/MeScreenHelpers';
import { useSettings } from '../../core/settings/SettingsContext';
import { Button } from '../../shared/components/Button';

interface MeAccountSectionProps {
  user: AppUser | null;
  onSignOut: () => void;
  onSignIn: () => void;
}

export function MeAccountSection({ user, onSignOut, onSignIn }: MeAccountSectionProps) {
  const { t, language, setLanguage } = useLanguage();
  const isGuest = !user;

  const { openSettings } = useSettings();

  return (
    <div>
      <SettingRow label={t('settings_language')}>
        <div className="flex bg-white/[0.04] rounded-lg p-0.5 gap-0.5">
          {(['ru', 'en'] as const).map(lang => (
            <Button
              type="button"
              key={lang}
              variant="ghost"
              size="sm"
              onClick={() => setLanguage(lang)}
              className={cn(
                "px-3 py-1 rounded-md border-none cursor-pointer text-xs font-medium",
                language === lang
                  ? "bg-white/[0.08] text-[rgba(232,236,233,0.9)]"
                  : "bg-transparent text-[rgba(74,81,77,1)]"
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
          onClick={() => openSettings()}
          className="text-xs px-3 py-1.5"
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
            className="text-xs font-semibold px-4 py-1.5 rounded-lg"
          >
            {t('nav_login')}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={onSignOut}
            className="text-xs text-accent-danger/70 hover:text-accent-danger px-3 py-1.5"
          >
            {t('nav_logout')}
          </Button>
        )}
      </SettingRow>
    </div>
  );
}
