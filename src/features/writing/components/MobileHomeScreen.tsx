import { useEffect, useState } from 'react';
import { useLanguage } from '../../../core/i18n';
import { Session } from '../../../types';
import type { SessionGroup, DailySummary } from '../hooks/useLifeLog';

interface MobileHomeScreenProps {
  userId: string;
  streakDays: number;
  sessionGroups: SessionGroup[];
  summary: DailySummary;
  onStart: () => void;
  onContinue: (session: Session) => void;
}

function getGreeting(t: (key: string) => string): { top: string; bottom: string } {
  const h = new Date().getHours();
  if (h < 6)  return { top: t('greeting_night'),   bottom: t('greeting_question') };
  if (h < 12) return { top: t('greeting_morning'),  bottom: t('greeting_question') };
  if (h < 18) return { top: t('greeting_day'),      bottom: t('greeting_question') };
  return       { top: t('greeting_evening'),         bottom: t('greeting_question') };
}

function formatDate(lang: string): string {
  return new Date().toLocaleDateString(lang, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export function MobileHomeScreen({
  userId, streakDays, sessionGroups, summary, onStart, onContinue
}: MobileHomeScreenProps) {
  const { t, language } = useLanguage();
  const greeting = getGreeting(t);

  const recentSessions = sessionGroups
    .flatMap(g => g.sessions)
    .slice(0, 3);

  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setPulse(p => !p), 2000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'var(--color-surface-base, #0b0d0c)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 30,
      overflow: 'hidden',
    }}>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 20px 0',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 10px 5px 8px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 999,
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="oklch(0.72 0.13 155)" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3c1 4 5 5 5 10a5 5 0 1 1-10 0c0-2 1-3 2-4-1 3 1 4 2 4s2-1 1-4c-1-3 0-5 0-6z"/>
          </svg>
          <span style={{
            fontSize: 12, fontWeight: 500,
            fontFamily: 'JetBrains Mono, monospace',
            color: 'rgba(232,236,233,0.9)',
          }}>
            {streakDays} {t('home_streak_days')}
          </span>
        </div>

        <div style={{
          width: 30, height: 30,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'rgba(138,145,141,1)',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4"/>
            <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>
          </svg>
        </div>
      </div>

      <div style={{ padding: '24px 24px 0' }}>
        <div style={{
          fontSize: 11,
          color: 'rgba(74,81,77,1)',
          fontFamily: 'JetBrains Mono, monospace',
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          marginBottom: 6,
        }}>
          {formatDate(language)}
        </div>
        <div style={{
          fontSize: 26,
          fontFamily: 'Lora, Georgia, serif',
          fontWeight: 500,
          letterSpacing: '-.01em',
          lineHeight: 1.25,
          color: 'rgba(232,236,233,0.95)',
        }}>
          {greeting.top},<br/>
          <span style={{ color: 'rgba(138,145,141,1)' }}>{greeting.bottom}</span>
        </div>
      </div>

      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 16,
      }}>
        <button
          onClick={onStart}
          style={{
            width: 140, height: 140,
            borderRadius: '50%',
            background: 'oklch(0.72 0.13 155)',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            boxShadow: pulse
              ? '0 0 0 16px oklch(0.72 0.13 155 / 0.08), 0 0 0 32px oklch(0.72 0.13 155 / 0.04)'
              : '0 0 0 8px oklch(0.72 0.13 155 / 0.06)',
            transition: 'box-shadow 1.8s ease-in-out, transform 0.15s',
            WebkitTapHighlightColor: 'transparent',
          }}
          onPointerDown={e => (e.currentTarget.style.transform = 'scale(0.96)')}
          onPointerUp={e => (e.currentTarget.style.transform = 'scale(1)')}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="#0b1a12">
            <path d="M8 5v14l11-7z"/>
          </svg>
          <span style={{
            fontSize: 12,
            fontWeight: 600,
            color: '#0b1a12',
            fontFamily: 'Inter, system-ui, sans-serif',
            letterSpacing: '.02em',
          }}>
            {t('home_cta')}
          </span>
        </button>

        <div style={{
          fontSize: 11,
          color: 'rgba(74,81,77,1)',
          fontFamily: 'JetBrains Mono, monospace',
          letterSpacing: '.04em',
        }}>
          {t('home_cta_hint')}
        </div>
      </div>

      <div style={{
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
      }}>
        {summary && (summary.totalWords > 0 || summary.totalMinutes > 0) && (
          <div style={{
            display: 'flex',
            gap: 20,
            padding: '0 24px 16px',
          }}>
            <div>
              <div style={{
                fontSize: 20,
                fontWeight: 500,
                color: 'rgba(232,236,233,0.9)',
                lineHeight: 1,
              }}>
                {summary.totalWords.toLocaleString()}
              </div>
              <div style={{
                fontSize: 10,
                color: 'rgba(74,81,77,1)',
                textTransform: 'uppercase',
                letterSpacing: '.06em',
                marginTop: 3,
              }}>
                {t('home_today_words')}
              </div>
            </div>
            <div>
              <div style={{
                fontSize: 20,
                fontWeight: 500,
                color: 'rgba(232,236,233,0.9)',
                lineHeight: 1,
              }}>
                {Math.round(summary.totalMinutes)}
                <span style={{ fontSize: 13, color: 'rgba(138,145,141,1)', marginLeft: 2 }}>
                  {t('goal_time_min')}
                </span>
              </div>
              <div style={{
                fontSize: 10,
                color: 'rgba(74,81,77,1)',
                textTransform: 'uppercase',
                letterSpacing: '.06em',
                marginTop: 3,
              }}>
                {t('home_today_flow')}
              </div>
            </div>
          </div>
        )}

        {recentSessions.length > 0 && (
          <div style={{ overflow: 'hidden' }}>
            <div style={{
              fontSize: 10,
              color: 'rgba(74,81,77,1)',
              textTransform: 'uppercase',
              letterSpacing: '.08em',
              fontFamily: 'JetBrains Mono, monospace',
              padding: '0 24px 10px',
            }}>
              {t('home_recent')}
            </div>
            <div style={{
              display: 'flex',
              gap: 8,
              padding: '0 24px',
              overflowX: 'auto',
              WebkitOverflowScrolling: 'touch',
              scrollbarWidth: 'none',
            }}>
              {recentSessions.map(session => (
                <button
                  key={session.id}
                  onClick={() => onContinue(session)}
                  style={{
                    flexShrink: 0,
                    padding: '10px 14px',
                    borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.07)',
                    background: 'rgba(255,255,255,0.03)',
                    textAlign: 'left',
                    cursor: 'pointer',
                    maxWidth: 180,
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <div style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: 'rgba(232,236,233,0.85)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    marginBottom: 4,
                  }}>
                    {session.title || t('common_untitled')}
                  </div>
                  <div style={{
                    fontSize: 11,
                    color: 'rgba(74,81,77,1)',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}>
                    {session.wordCount} {t('home_words_short')} ·{' '}
                    {Math.floor(session.duration / 60)}{t('goal_time_min')}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
