import React from 'react';
import { User } from 'firebase/auth';
import { useLanguage } from '../../../core/i18n';
import { SettingRow } from './MeScreenHelpers';
import { useSettings } from '../../../core/settings/SettingsContext';
import { Button } from '../../../shared/components/Button';

interface MeAccountSectionProps {
  user: User | null;
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
        <div style={{
          display: 'flex',
          background: 'rgba(255,255,255,0.04)',
          borderRadius: 8,
          padding: 2,
          gap: 2,
        }}>
          {(['ru', 'en'] as const).map(lang => (
            <button
              type="button"
              key={lang}
              onClick={() => setLanguage(lang)}
              style={{
                padding: '5px 12px',
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 500,
                background: language === lang
                  ? 'rgba(255,255,255,0.08)'
                  : 'transparent',
                color: language === lang
                  ? 'rgba(232,236,233,0.9)'
                  : 'rgba(74,81,77,1)',
              }}
            >
              {lang.toUpperCase()}
            </button>
          ))}
        </div>
      </SettingRow>

      {user?.email && (
        <SettingRow label={t('me_account_email')}>
          <span style={{
            fontSize: 12,
            color: 'rgba(74,81,77,1)',
            fontFamily: 'JetBrains Mono, monospace',
            maxWidth: 180,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {user.email}
          </span>
        </SettingRow>
      )}

      {isGuest ? (
        <Button
          variant="brand"
          size="md"
          onClick={onSignIn}
          className="mt-6 w-full py-3.5 rounded-xl border border-brand-primary/30 bg-brand-primary/8 text-brand-primary text-sm font-medium"
        >
          {t('auth_sign_in')}
        </Button>
      ) : (
        <Button
          variant="danger"
          size="md"
          onClick={onSignOut}
          className="mt-6 w-full py-3.5 rounded-xl border border-accent-danger/25 bg-accent-danger/6 text-accent-danger/80 text-sm font-medium"
        >
          {t('me_sign_out')}
        </Button>
      )}

      <Button
        variant="ghost"
        size="md"
        onClick={() => openSettings('account')}
        className="mt-4 w-full py-3 rounded-xl border border-white/[0.07] bg-white/[0.03] text-white/80 text-sm font-medium text-center"
      >
        {t('settings_encryption_management') || 'Настройки шифрования и аккаунта →'}
      </Button>
    </div>
  );
}
