import React, { useEffect, useState } from 'react';
import { useLanguage } from '../../../core/i18n';
import { Session } from '../../../types';
import type { SessionGroup, DailySummary, LifeLogDocument } from '../types/lifeLog';
import { ConnectionStatusBanner } from './ConnectionStatusBanner';
import { useNavigate } from 'react-router-dom';
import { cn } from '../../../core/utils/utils';
import { Settings } from 'lucide-react';
import { useSettings } from '../../../core/settings/SettingsContext';

interface MobileHomeScreenProps {
  userId: string;
  streakDays: number;
  sessionGroups: SessionGroup[];
  summary: DailySummary;
  onStart: () => void;
  onContinue: (session: Session | LifeLogDocument) => void;
  hasDraft?: boolean;
  restoreDraft?: () => void;
  discardDraft?: () => void;
  onRefresh?: () => Promise<void> | void;
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
  userId: _userId,
  streakDays,
  sessionGroups,
  summary,
  onStart,
  onContinue,
  hasDraft,
  restoreDraft,
  discardDraft,
  onRefresh,
}: MobileHomeScreenProps) {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const { openSettings } = useSettings();
  const greeting = getGreeting(t);

  const recentSessions = sessionGroups
    .flatMap(g => g.sessions)
    .slice(0, 3);

  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setPulse(p => !p), 2000);
    return () => clearInterval(timer);
  }, []);

  const [touchStartY, setTouchStartY] = useState<number | null>(null);
  const [pullOffset, setPullOffset] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartY(e.touches[0].clientY);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartY === null || refreshing) return;
    const currentY = e.touches[0].clientY;
    const diff = currentY - touchStartY;
    if (diff > 0) {
      setPullOffset(Math.min(80, diff * 0.45));
    }
  };

  const handleTouchEnd = async () => {
    if (touchStartY === null || refreshing) return;
    if (pullOffset > 50 && onRefresh) {
      setRefreshing(true);
      try {
        await onRefresh();
      } catch (e) {
        console.error('Refresh failed:', e);
      } finally {
        setRefreshing(false);
      }
    }
    setTouchStartY(null);
    setPullOffset(0);
  };

  return (
    <div 
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--color-surface-base, #0b0d0c)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 30,
        overflow: 'hidden',
      }}
    >
      {/* Pull to refresh indicator */}
      {pullOffset > 0 && (
        <div style={{
          position: 'absolute',
          top: 10,
          left: '50%',
          transform: `translateX(-50%) translateY(${pullOffset - 20}px)`,
          opacity: pullOffset / 50,
          zIndex: 100,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'var(--surface-card)',
          border: '1px solid var(--border-light)',
          padding: '6px 12px',
          borderRadius: 99,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          pointerEvents: 'none',
        }}>
          <div className={cn("w-3.5 h-3.5 border-2 border-brand-primary border-t-transparent rounded-full", refreshing && "animate-spin")} />
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 500 }}>
            {refreshing ? t('offline_syncing') : 'Потяните для обновления'}
          </span>
        </div>
      )}

      <ConnectionStatusBanner />

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
          background: 'var(--surface-card)',
          border: '1px solid var(--border-light)',
          borderRadius: 999,
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="var(--brand-primary)" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3c1 4 5 5 5 10a5 5 0 1 1-10 0c0-2 1-3 2-4-1 3 1 4 2 4s2-1 1-4c-1-3 0-5 0-6z"/>
          </svg>
          <span style={{
            fontSize: 12, fontWeight: 500,
            fontFamily: 'JetBrains Mono, monospace',
            color: 'var(--text-main)',
          }}>
            {streakDays} {t('home_streak_days')}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={() => openSettings()}
            style={{
              width: 44, height: 44,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
            aria-label={t('nav_settings')}
          >
            <div style={{
              width: 32, height: 32,
              borderRadius: '50%',
              background: 'var(--surface-elevated)',
              border: '1px solid var(--border-light)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-muted)',
            }}>
              <Settings size={15} />
            </div>
          </button>

          <button
            onClick={() => navigate('/me')}
            style={{
              width: 44, height: 44,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
            aria-label={t('nav_me')}
          >
            <div style={{
              width: 32, height: 32,
              borderRadius: '50%',
              background: 'var(--surface-elevated)',
              border: '1px solid var(--border-light)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-muted)',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1.6"
                strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4"/>
                <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>
              </svg>
            </div>
          </button>
        </div>
      </div>

      {hasDraft && (
        <div style={{
          margin: '12px 20px 0',
          padding: '14px 16px',
          borderRadius: 16,
          border: '1px solid rgba(245,158,11,0.25)',
          background: 'rgba(245,158,11,0.06)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}>
          <span style={{ fontSize: 13, color: 'rgba(245,158,11,0.85)', lineHeight: 1.45, fontWeight: 500 }}>
            {t('draft_restore_prompt')}
          </span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={restoreDraft}
              style={{
                background: 'rgba(245,158,11,0.15)',
                border: '1px solid rgba(245,158,11,0.3)',
                borderRadius: 10,
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: 600,
                color: '#f59e0b',
                cursor: 'pointer',
              }}
            >
              {t('draft_restore')}
            </button>
            <button
              onClick={discardDraft}
              style={{
                background: 'transparent',
                border: 'none',
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 500,
                color: 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              {t('draft_discard')}
            </button>
          </div>
        </div>
      )}

      <div style={{ padding: '20px 24px 0' }}>
        <div style={{
          fontSize: 11,
          color: 'var(--text-subtle)',
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
          color: 'var(--text-main)',
        }}>
          {greeting.top},<br/>
          <span style={{ color: 'var(--text-muted)' }}>{greeting.bottom}</span>
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
            background: 'var(--brand-primary)',
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
          color: 'var(--text-subtle)',
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
                color: 'var(--text-main)',
                lineHeight: 1,
              }}>
                {summary.totalWords.toLocaleString()}
              </div>
              <div style={{
                fontSize: 10,
                color: 'var(--text-subtle)',
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
                color: 'var(--text-main)',
                lineHeight: 1,
              }}>
                {Math.round(summary.totalMinutes)}
                <span style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 2 }}>
                  {t('goal_time_min')}
                </span>
              </div>
              <div style={{
                fontSize: 10,
                color: 'var(--text-subtle)',
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
              color: 'var(--text-subtle)',
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
                    border: '1px solid var(--border-light)',
                    background: 'var(--surface-card)',
                    textAlign: 'left',
                    cursor: 'pointer',
                    maxWidth: 180,
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <div style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: 'var(--text-main)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    marginBottom: 4,
                  }}>
                    {session.title || t('common_untitled')}
                  </div>
                  <div style={{
                    fontSize: 11,
                    color: 'var(--text-subtle)',
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
