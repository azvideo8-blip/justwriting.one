import React from 'react';
import type { AppUser } from '../../core/auth/types';
import { useLanguage } from '../../shared/i18n';
import { SettingRow } from '../../shared/components/MeScreenHelpers';
import { LanguageSwitch } from '../../shared/components/LanguageSwitch';
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
  const { t } = useLanguage();
  const isGuest = !user;

  const { openSettings } = useSettings();
  const { layoutMode } = useLayoutMode();
  const navigate = useNavigate();
  // MF-9: на телефоне строка «Настройки» ведёт в настройки приложения, а не в
  // панель редактора; десктоп сохраняет панель.
  const openAppSettings = () => (layoutMode === 'mobile' ? void navigate('/settings') : openSettings());

  return (
    <div>
      {/* U-28 (решение владельца 2026-10-18): общий контрол языка — сетка с
          инверсией, как в десктопной вкладке «Редактор»; второго вида с
          приглушённой подложкой на телефоне больше нет. */}
      <div className="py-3.5 border-b border-border-subtle">
        <div className="text-sm text-text-main/80">{t('settings_language')}</div>
        <div className="mt-2">
          <LanguageSwitch />
        </div>
      </div>

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
