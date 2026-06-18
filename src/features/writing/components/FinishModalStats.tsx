import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { formatTime } from '../../../core/utils/formatTime';
import { StreakDots } from '../../../shared/components/StreakDots';
import { Button } from '../../../shared/components/Button';

const WpmChart = React.lazy(() => import('./WpmChart').then(m => ({ default: m.WpmChart })));

interface FinishModalStatsProps {
  animWords: number;
  animSeconds: number;
  animWpm: number;
  sessionSeconds: number;
  totalPauseSeconds: number;
  avgWpm: number;
  wpmHistory: { timestamp: number; wpm: number }[];
  streakDays: number;
  sessionGroups: { date: Date; sessions: unknown[] }[];
  t: (k: string) => string;
  isMobile: boolean;
  statsExpanded: boolean;
  setStatsExpanded: (v: boolean) => void;
}

export function FinishModalStats({
  animWords,
  animSeconds,
  animWpm,
  sessionSeconds,
  totalPauseSeconds,
  avgWpm,
  wpmHistory,
  streakDays,
  sessionGroups,
  t,
  isMobile,
  statsExpanded,
  setStatsExpanded,
}: FinishModalStatsProps) {
  const borderStyle = {
    borderImage: 'linear-gradient(to bottom, transparent, var(--color-border-subtle), transparent) 1',
    borderLeft: '1px solid',
    borderRight: '1px solid',
  };
  if (isMobile) {
    return (
      <div className="border border-border-subtle rounded-2xl overflow-hidden bg-surface-base/10">
        <Button
          variant="ghost"
          size="md"
          onClick={() => setStatsExpanded(!statsExpanded)}
          className="w-full px-4 py-3 flex items-center justify-between bg-surface-base/20 hover:bg-surface-base/30 font-semibold text-sm"
        >
          <span>{t('finish_wpm_chart') || 'Session Stats'}</span>
          {statsExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </Button>

        {statsExpanded && (
          <div className="p-4 space-y-4">
            {streakDays > 0 ? (
              <div className="text-center">
                <div className="text-3xl font-mono font-bold text-brand-primary tabular-nums">{streakDays}</div>
                <div className="text-label font-bold uppercase tracking-widest text-text-main/60 mt-0.5">{t('finish_streak_days')}</div>
                <StreakDots sessionGroups={sessionGroups} variant="modal" />
              </div>
            ) : (
              <div className="text-center text-xs text-text-main/60">{t('finish_streak_zero')}</div>
            )}

            <div className="grid grid-cols-3 text-center">
              <div className="p-1">
                <div className="text-label font-bold uppercase tracking-widest mb-0.5 text-text-main/60">{t('writing_words')}</div>
                <div className="text-lg font-mono font-bold text-text-main tabular-nums">{animWords}</div>
              </div>
              <div className="p-1 border-l border-r border-border-subtle">
                <div className="text-label font-bold uppercase tracking-widest mb-0.5 text-text-main/60">{t('writing_time')}</div>
                <div className="text-lg font-mono font-bold text-text-main tabular-nums">{formatTime(animSeconds)}</div>
              </div>
              <div className="p-1">
                <div className="text-label font-bold uppercase tracking-widest mb-0.5 text-text-main/60">{t('writing_wpm')}</div>
                <div className="text-lg font-mono font-bold text-text-main tabular-nums">{animWpm}</div>
              </div>
            </div>

            {totalPauseSeconds > 0 && (
              <div className="space-y-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-text-main/60">{t('finish_flow_time')}</span>
                  <span className="font-mono text-text-main tabular-nums">{formatTime(sessionSeconds)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-main/60">{t('finish_distraction_time')}</span>
                  <span className="font-mono text-accent-warning tabular-nums">{formatTime(totalPauseSeconds)}</span>
                </div>
              </div>
            )}

            {wpmHistory.length >= 2 && (
              <div className="rounded-xl bg-surface-base border border-border-subtle px-3 py-2">
                <React.Suspense fallback={null}>
                  <WpmChart data={wpmHistory} avgWpm={avgWpm} height={60} />
                </React.Suspense>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {streakDays > 0 ? (
        <div className="text-center">
          <div className="text-2xl font-mono font-bold text-brand-primary tabular-nums">{streakDays}</div>
          <div className="text-label-sm font-bold uppercase tracking-widest text-text-main/60 mt-1">{t('finish_streak_days')}</div>
          <StreakDots sessionGroups={sessionGroups} variant="modal" />
        </div>
      ) : (
        <div className="text-center text-sm text-text-main/60">{t('finish_streak_zero')}</div>
      )}

      <div className="grid grid-cols-3 text-center">
        <div className="p-2">
          <div className="text-label-sm font-bold uppercase tracking-widest mb-1 text-text-main/60">{t('writing_words')}</div>
          <div className="text-xl font-mono font-bold text-text-main tabular-nums">{animWords}</div>
        </div>
        <div className="p-2" style={borderStyle}>
          <div className="text-label-sm font-bold uppercase tracking-widest mb-1 text-text-main/60">{t('writing_time')}</div>
          <div className="text-xl font-mono font-bold text-text-main tabular-nums">{formatTime(animSeconds)}</div>
        </div>
        <div className="p-2">
          <div className="text-label-sm font-bold uppercase tracking-widest mb-1 text-text-main/60">{t('writing_wpm')}</div>
          <div className="text-xl font-mono font-bold text-text-main tabular-nums">{animWpm}</div>
        </div>
      </div>

      {totalPauseSeconds > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-main/60">{t('finish_flow_time')}</span>
            <span className="font-mono text-text-main tabular-nums">{formatTime(sessionSeconds)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-main/60">{t('finish_distraction_time')}</span>
            <span className="font-mono text-accent-warning tabular-nums">{formatTime(totalPauseSeconds)}</span>
          </div>
        </div>
      )}

      {wpmHistory.length >= 2 && (
        <div className="rounded-2xl bg-surface-base border border-border-subtle px-4 py-3">
          <div className="text-label font-bold uppercase tracking-widest text-text-main/60 mb-3">
            {t('finish_wpm_chart')}
          </div>
          <React.Suspense fallback={null}>
            <WpmChart data={wpmHistory} avgWpm={avgWpm} height={72} />
          </React.Suspense>
        </div>
      )}
    </>
  );
}
