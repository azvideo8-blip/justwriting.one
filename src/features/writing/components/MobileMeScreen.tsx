import React, { useState } from 'react';
import { useLanguage } from '../../../core/i18n';
import { useWritingSettings } from '../contexts/WritingSettingsContext';
import { UserProfile } from '../../../types';
import { User } from 'firebase/auth';
import { Toggle } from '../../../shared/components/Toggle';
import { getFontStack } from '../utils/fontStack';

interface MobileMeScreenProps {
  user: User;
  profile: UserProfile | null;
  onSignOut: () => void;
}

type Section = 'stats' | 'writing' | 'account';

function StatCard({ value, label, accent }: {
  value: string | number;
  label: string;
  accent?: boolean;
}) {
  return (
    <div style={{
      flex: 1,
      padding: '14px 16px',
      background: 'rgba(255,255,255,0.03)',
      border: `1px solid ${accent ? 'oklch(0.72 0.13 155 / 0.3)' : 'rgba(255,255,255,0.07)'}`,
      borderRadius: 14,
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <div style={{
        fontSize: 24,
        fontWeight: 500,
        color: accent ? 'oklch(0.72 0.13 155)' : 'rgba(232,236,233,0.95)',
        lineHeight: 1,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </div>
      <div style={{
        fontSize: 11,
        color: 'rgba(74,81,77,1)',
        textTransform: 'uppercase',
        letterSpacing: '.06em',
        fontFamily: 'JetBrains Mono, monospace',
      }}>
        {label}
      </div>
    </div>
  );
}

function SettingRow({ label, children, hint }: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div style={{
      padding: '14px 0',
      borderBottom: '1px solid rgba(255,255,255,0.05)',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}>
        <span style={{ fontSize: 14, color: 'rgba(232,236,233,0.8)' }}>
          {label}
        </span>
        {children}
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: 'rgba(74,81,77,1)' }}>{hint}</div>
      )}
    </div>
  );
}

export function MobileMeScreen({ user, profile, onSignOut }: MobileMeScreenProps) {
  const { t, language, setLanguage } = useLanguage();
  const {
    fontFamily, setFontFamily,
    fontSize, setFontSize,
    zenModeEnabled, setZenModeEnabled,
   } = useWritingSettings();

  const [activeSection, setActiveSection] = useState<Section>('stats');

  const sections: { id: Section; label: string }[] = [
    { id: 'stats',   label: t('me_tab_stats') },
    { id: 'writing', label: t('me_tab_writing') },
    { id: 'account', label: t('me_tab_account') },
  ];

  const initials = (profile?.nickname || user.displayName || user.email || 'U')
    .slice(0, 2).toUpperCase();

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'var(--color-surface-base, #0b0d0c)',
      zIndex: 30,
      display: 'flex',
      flexDirection: 'column',
      paddingTop: 'env(safe-area-inset-top, 0px)',
    }}>

      <div style={{ padding: '20px 20px 0' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          marginBottom: 20,
        }}>
          {user.photoURL ? (
            <img
              src={user.photoURL}
              alt={initials}
              style={{
                width: 52, height: 52,
                borderRadius: '50%',
                objectFit: 'cover',
                border: '1px solid rgba(255,255,255,0.1)',
              }}
            />
          ) : (
            <div style={{
              width: 52, height: 52,
              borderRadius: '50%',
              background: 'oklch(0.72 0.13 155 / 0.15)',
              border: '1px solid oklch(0.72 0.13 155 / 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              fontWeight: 600,
              color: 'oklch(0.72 0.13 155)',
              fontFamily: 'Inter, system-ui, sans-serif',
            }}>
              {initials}
            </div>
          )}

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 17,
              fontWeight: 500,
              color: 'rgba(232,236,233,0.95)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {profile?.nickname || user.displayName || t('me_anonymous')}
            </div>
            <div style={{
              fontSize: 12,
              color: 'rgba(74,81,77,1)',
              fontFamily: 'JetBrains Mono, monospace',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {user.email}
            </div>
          </div>
        </div>

        <div style={{
          display: 'flex',
          background: 'rgba(255,255,255,0.04)',
          borderRadius: 10,
          padding: 3,
          gap: 2,
          marginBottom: 20,
        }}>
          {sections.map(s => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              style={{
                flex: 1,
                padding: '7px 0',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 500,
                fontFamily: 'Inter, system-ui, sans-serif',
                background: activeSection === s.id
                  ? 'rgba(255,255,255,0.08)'
                  : 'transparent',
                color: activeSection === s.id
                  ? 'rgba(232,236,233,0.9)'
                  : 'rgba(74,81,77,1)',
                transition: 'all 0.15s',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '0 20px',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
        WebkitOverflowScrolling: 'touch',
      }}>

        {activeSection === 'stats' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <StatCard
                value={(profile?.totalWordCount || 0).toLocaleString()}
                label={t('me_stat_total_words')}
                accent
              />
              <StatCard
                value={profile?.sessionsCount || 0}
                label={t('me_stat_sessions')}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <StatCard
                value={profile?.streakDays || 0}
                label={t('me_stat_streak')}
              />
              <StatCard
                value={`${Math.round((profile?.totalDuration || 0) / 60)}ч`}
                label={t('me_stat_total_time')}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <StatCard
                value={profile?.avgWpm || 0}
                label={t('me_stat_avg_wpm')}
              />
              <StatCard
                value={profile?.avgSessionWords || 0}
                label={t('me_stat_avg_session')}
              />
            </div>
          </div>
        )}

        {activeSection === 'writing' && (
          <div>
            <div style={{
              fontSize: 10,
              color: 'rgba(74,81,77,1)',
              textTransform: 'uppercase',
              letterSpacing: '.08em',
              fontFamily: 'JetBrains Mono, monospace',
              marginBottom: 8,
            }}>
              {t('settings_section_font')}
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 6,
              marginBottom: 20,
            }}>
              {[
                { id: 'sans',  label: 'Inter',         sample: 'Aa 123' },
                { id: 'serif', label: 'Playfair',       sample: 'Aa 123' },
                { id: 'mono',  label: 'JetBrains Mono', sample: 'Aa 123' },
              ].map(f => (
                <button
                  key={f.id}
                  onClick={() => setFontFamily(f.id)}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 12,
                    border: `1px solid ${fontFamily === f.id
                      ? 'oklch(0.72 0.13 155 / 0.5)'
                      : 'rgba(255,255,255,0.07)'}`,
                    background: fontFamily === f.id
                      ? 'oklch(0.72 0.13 155 / 0.08)'
                      : 'rgba(255,255,255,0.03)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <div style={{
                    fontSize: 15,
                    fontFamily: getFontStack(f.id),
                    color: 'rgba(232,236,233,0.9)',
                    marginBottom: 2,
                  }}>
                    {f.sample}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(138,145,141,1)' }}>
                    {f.label}
                  </div>
                </button>
              ))}
            </div>

            <SettingRow label={t('settings_font_size')} hint={`${fontSize}px`}>
              <input
                type="range"
                min={14} max={28}
                value={fontSize}
                onChange={e => setFontSize(Number(e.target.value))}
                style={{ width: 100 }}
              />
            </SettingRow>

            <SettingRow label={t('settings_zen_mode')}>
              <Toggle checked={zenModeEnabled} onChange={setZenModeEnabled} />
            </SettingRow>
           </div>
        )}

        {activeSection === 'account' && (
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
          </div>
        )}
      </div>
    </div>
  );
}
