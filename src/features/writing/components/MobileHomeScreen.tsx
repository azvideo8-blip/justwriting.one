import React, { useEffect, useState } from 'react';
import { useLanguage } from '../../../shared/i18n';
import { Session } from '../../../types';
import type { SessionGroup, DailySummary, LifeLogDocument } from '../types/lifeLog';
import { ConnectionStatusBanner } from './ConnectionStatusBanner';
import { useNavigate } from 'react-router-dom';
import { cn } from '../../../core/utils/utils';
import { Settings } from 'lucide-react';
import { useSettings } from '../../../core/settings/SettingsContext';
import { IconButton } from '../../../shared/components/IconButton';
import { Button } from '../../../shared/components/Button';

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
    const touch = e.touches[0];
    if (!touch) return;
    setTouchStartY(touch.clientY);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartY === null || refreshing) return;
    const touch = e.touches[0];
    if (!touch) return;
    const currentY = touch.clientY;
    const diff = currentY - touchStartY;
    if (diff > 0) {
      setPullOffset(Math.min(80, diff * 0.45));
    }
  };

  const handleTouchEnd = () => {
    if (touchStartY === null || refreshing) return;
    if (pullOffset > 50 && onRefresh) {
      setRefreshing(true);
      const refreshResult = onRefresh();
      if (refreshResult) {
        refreshResult.then(() => {
          setRefreshing(false);
        }).catch((e: unknown) => {
          console.error('Refresh failed:', e);
          setRefreshing(false);
        });
      } else {
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
      className="fixed inset-0 bg-[var(--color-surface-base,#0b0d0c)] flex flex-col z-30 overflow-hidden"
    >
      {/* Pull to refresh indicator */}
      {pullOffset > 0 && (
        <div className="absolute top-2.5 left-1/2 z-[100] flex items-center gap-1.5 bg-[var(--surface-card)] border border-[var(--border-light)] px-3 py-1.5 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.3)] pointer-events-none" style={{
          transform: `translateX(-50%) translateY(${pullOffset - 20}px)`,
          opacity: pullOffset / 50,
        }}>
          <div className={cn("w-3.5 h-3.5 border-2 border-brand-primary border-t-transparent rounded-full", refreshing && "animate-spin")} />
          <span className="text-[10px] text-[var(--text-muted)] font-medium">
            {refreshing ? t('offline_syncing') : t('pull_to_refresh')}
          </span>
        </div>
      )}

      <ConnectionStatusBanner />

      <div className="flex items-center justify-between px-5 pt-3 pt-[calc(env(safe-area-inset-top,0px)+12px)]">
        <div className="flex items-center gap-1.5 pl-2 pr-2.5 py-1.5 bg-[var(--surface-card)] border border-[var(--border-light)] rounded-full">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="var(--brand-primary)" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3c1 4 5 5 5 10a5 5 0 1 1-10 0c0-2 1-3 2-4-1 3 1 4 2 4s2-1 1-4c-1-3 0-5 0-6z"/>
          </svg>
          <span className="text-xs font-medium font-mono text-[var(--text-main)]">
            {streakDays} {t('home_streak_days')}
          </span>
        </div>

        <div className="flex items-center gap-1" >
          <IconButton
            icon={
              <div className="w-8 h-8 rounded-full bg-[var(--surface-elevated)] border border-[var(--border-light)] flex items-center justify-center text-[var(--text-muted)]">
                <Settings size={15} />
              </div>
            }
            label={t('nav_settings')}
            onClick={() => openSettings()}
            className="w-11 h-11"
          />

          <IconButton
            icon={
              <div className="w-8 h-8 rounded-full bg-[var(--surface-elevated)] border border-[var(--border-light)] flex items-center justify-center text-[var(--text-muted)]">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.6"
                  strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="4"/>
                  <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>
                </svg>
              </div>
            }
            label={t('nav_me')}
            onClick={() => void navigate('/me')}
            className="w-11 h-11"
          />
        </div>
      </div>

      {hasDraft && (
        <div className="mx-5 mt-3 p-3.5 rounded-2xl border border-[color-mix(in_srgb,var(--accent-warning)_25%,transparent)] bg-[color-mix(in_srgb,var(--accent-warning)_6%,transparent)] flex flex-col gap-2.5">
          <span className="text-[13px] text-[color-mix(in_srgb,var(--accent-warning)_85%,var(--text-main))] leading-snug font-medium">
            {t('draft_restore_prompt')}
          </span>
          <div className="flex gap-2.5" >
            <Button
              variant="ghost"
              size="sm"
              onClick={restoreDraft}
              className="rounded-xl font-semibold text-xs text-accent-warning bg-[color-mix(in_srgb,var(--accent-warning)_15%,transparent)] border border-[color-mix(in_srgb,var(--accent-warning)_30%,transparent)]"
            >
              {t('draft_restore')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={discardDraft}
              className="text-xs text-text-muted"
            >
              {t('draft_discard')}
            </Button>
          </div>
        </div>
      )}

      <div className="px-6 pt-5">
        <div className="text-[11px] text-[var(--text-subtle)] font-mono tracking-[0.08em] uppercase mb-1.5">
          {formatDate(language)}
        </div>
        <div className="text-[26px] font-serif font-medium tracking-tight leading-tight text-[var(--text-main)]">
          {greeting.top},<br/>
          <span className="text-[var(--text-muted)]">{greeting.bottom}</span>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center flex-col gap-4" >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onStart}
          className="w-[140px] h-[140px] rounded-full bg-[var(--brand-primary)] border-none cursor-pointer flex flex-col items-center justify-center gap-1 transition-[box-shadow,transform] duration-[1.8s,0.15s] ease-in-out"
          style={{
            boxShadow: pulse
              ? '0 0 0 16px oklch(0.72 0.13 155 / 0.08), 0 0 0 32px oklch(0.72 0.13 155 / 0.04)'
              : '0 0 0 8px oklch(0.72 0.13 155 / 0.06)',
          }}
          onPointerDown={e => (e.currentTarget.style.transform = 'scale(0.96)')}
          onPointerUp={e => (e.currentTarget.style.transform = 'scale(1)')}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="var(--bg-base)">
            <path d="M8 5v14l11-7z"/>
          </svg>
          <span className="text-xs font-semibold text-[var(--bg-base)] font-sans tracking-wide">
            {t('home_cta')}
          </span>
        </Button>

        <div className="text-[11px] text-[var(--text-subtle)] font-mono tracking-wider">
          {t('home_cta_hint')}
        </div>
      </div>

      <div className="pb-[calc(env(safe-area-inset-bottom,0px)+80px)]">
        {(summary.totalWords > 0 || summary.totalMinutes > 0) && (
          <div className="flex gap-5 px-6 pb-4">
            <div>
              <div className="text-xl font-medium text-[var(--text-main)] leading-none">
                {summary.totalWords.toLocaleString()}
              </div>
              <div className="text-[10px] text-[var(--text-subtle)] uppercase tracking-[0.06em] mt-0.5">
                {t('home_today_words')}
              </div>
            </div>
            <div>
              <div className="text-xl font-medium text-[var(--text-main)] leading-none">
                {Math.round(summary.totalMinutes)}
                <span className="text-[13px] text-[var(--text-muted)] ml-0.5">
                  {t('goal_time_min')}
                </span>
              </div>
              <div className="text-[10px] text-[var(--text-subtle)] uppercase tracking-[0.06em] mt-0.5">
                {t('home_today_flow')}
              </div>
            </div>
          </div>
        )}

        {recentSessions.length > 0 && (
          <div className="overflow-hidden" >
            <div className="text-[10px] text-[var(--text-subtle)] uppercase tracking-[0.08em] font-mono px-6 pb-2.5">
              {t('home_recent')}
            </div>
            <div className="flex gap-2 px-6 overflow-x-auto touch-pan-x scrollbar-none">
              {recentSessions.map(session => (
                <Button
                  type="button"
                  key={session.id}
                  variant="ghost"
                  size="sm"
                  onClick={() => onContinue(session)}
                  className="shrink-0 py-2.5 px-3.5 rounded-xl border border-[var(--border-light)] bg-[var(--surface-card)] text-left cursor-pointer max-w-[180px]"
                >
                  <div className="text-[13px] font-medium text-[var(--text-main)] whitespace-nowrap overflow-hidden text-ellipsis mb-1">
                    {session.title || t('common_untitled')}
                  </div>
                  <div className="text-[11px] text-[var(--text-subtle)] font-mono">
                    {session.wordCount} {t('home_words_short')} ·{' '}
                    {Math.floor(session.duration / 60)}{t('goal_time_min')}
                  </div>
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
