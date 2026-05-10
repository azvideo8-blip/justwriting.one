import React from 'react';
import { User } from 'firebase/auth';
import { useLanguage } from '../../../core/i18n';
import { SettingRow } from './MeScreenHelpers';

interface MeAccountSectionProps {
  user: User | null;
  onSignOut: () => void;
  onSignIn: () => void;
}

export function MeAccountSection({ user, onSignOut, onSignIn }: MeAccountSectionProps) {
  const { t, language, setLanguage } = useLanguage();
  const isGuest = !user;

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
        <button
          onClick={onSignIn}
          style={{
            marginTop: 24,
            width: '100%',
            padding: '14px',
            borderRadius: 14,
            border: '1px solid oklch(0.72 0.13 155 / 0.3)',
            background: 'oklch(0.72 0.13 155 / 0.08)',
            color: 'var(--brand-primary)',
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: 'Inter, system-ui, sans-serif',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {t('auth_sign_in')}
        </button>
      ) : (
        <button
          onClick={onSignOut}
          style={{
            marginTop: 24,
            width: '100%',
            padding: '14px',
            borderRadius: 14,
            border: '1px solid rgba(239,68,68,0.25)',
            background: 'rgba(239,68,68,0.06)',
            color: 'rgba(239,68,68,0.8)',
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: 'Inter, system-ui, sans-serif',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {t('me_sign_out')}
        </button>
      )}
    </div>
  );
}
