import React, { useState, useEffect } from 'react';
import { useLanguage } from '../../../core/i18n';
import { UserProfile } from '../../../types';
import { User } from 'firebase/auth';
import { LocalDocumentService } from '../services/LocalDocumentService';
import { getOrCreateGuestId, LocalProfile } from '../../../shared/lib/localDb';
import { MeStatsSection } from './MeStatsSection';
import { MeWritingSection } from './MeWritingSection';
import { MeAccountSection } from './MeAccountSection';

interface MobileMeScreenProps {
  user: User | null;
  profile: UserProfile | null;
  onSignOut: () => void;
  onSignIn: () => void;
}

type Section = 'stats' | 'writing' | 'account';

export function MobileMeScreen({ user, profile, onSignOut, onSignIn }: MobileMeScreenProps) {
  const { t } = useLanguage();
  const [activeSection, setActiveSection] = useState<Section>('stats');
  const [localProfile, setLocalProfile] = useState<LocalProfile | undefined>(undefined);
  const isGuest = !user;

  useEffect(() => {
    if (isGuest) {
      LocalDocumentService.getProfile(getOrCreateGuestId()).then(p => setLocalProfile(p ?? undefined));
    }
  }, [isGuest]);

  const statsProfile = isGuest
    ? { totalWordCount: localProfile?.totalWords ?? 0, sessionsCount: localProfile?.sessionsCount ?? 0, totalDuration: localProfile?.totalDuration ?? 0, streakDays: 0, avgWpm: 0, avgSessionWords: 0 }
    : profile;

  const sections: { id: Section; label: string }[] = [
    { id: 'stats',   label: t('me_tab_stats') },
    { id: 'writing', label: t('me_tab_writing') },
    { id: 'account', label: t('me_tab_account') },
  ];

  const initials = (profile?.nickname || user?.displayName || user?.email || 'G')
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
          {user?.photoURL ? (
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
              color: 'var(--brand-primary)',
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
              {profile?.nickname || user?.displayName || t('me_anonymous')}
            </div>
            {user?.email && (
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
            )}
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
        {activeSection === 'stats' && <MeStatsSection profile={statsProfile} />}
        {activeSection === 'writing' && <MeWritingSection />}
        {activeSection === 'account' && <MeAccountSection user={user} onSignOut={onSignOut} onSignIn={onSignIn} />}
      </div>
    </div>
  );
}
