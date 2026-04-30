import React, { useState, useRef, useEffect } from 'react';
import { cn } from '../../../core/utils/utils';
import { useLanguage } from '../../../core/i18n';
import { formatTime } from '../../../core/utils/formatTime';
import { GoalPopup } from './GoalPopup';
import { getWpmColor } from '../utils/wpmColors';
import { HeaderVisibility } from '../contexts/WritingSettingsContext';

interface HeaderStatsProps {
  wordGoal: number;
  timerDuration: number;
  onSetWordGoal: (v: number) => void;
  onSetTimerDuration: (v: number) => void;
  sessionWords: number;
  sessionSeconds: number;
  wordCount: number;
  wpm: number;
  status: 'idle' | 'writing' | 'paused' | 'finished';
  visibility: HeaderVisibility;
}

export const HeaderStats = React.memo(function HeaderStats({
  wordGoal, timerDuration, onSetWordGoal, onSetTimerDuration,
  sessionWords, sessionSeconds, wordCount, wpm, status,
  visibility
}: HeaderStatsProps) {
  const { t } = useLanguage();
  
  const [wordPopupOpen, setWordPopupOpen] = useState(false);
  const [timePopupOpen, setTimePopupOpen] = useState(false);
  
  const wordBlockRef = useRef<HTMLDivElement>(null);
  const timeBlockRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-goal-popup]')) return;
      if (
        wordBlockRef.current && !wordBlockRef.current.contains(target) &&
        timeBlockRef.current && !timeBlockRef.current.contains(target)
      ) {
        setWordPopupOpen(false);
        setTimePopupOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const timeRemaining = timerDuration > 0 ? Math.max(0, timerDuration - sessionSeconds) : sessionSeconds;
  const wordProgress = wordGoal > 0 ? Math.min(100, Math.round(sessionWords / wordGoal * 100)) : null;
  const timeProgress = timerDuration > 0 ? Math.min(100, Math.round(sessionSeconds / timerDuration * 100)) : null;
  const wordDone = wordGoal > 0 && sessionWords >= wordGoal;
  const timeDone = timerDuration > 0 && sessionSeconds >= timerDuration;

  return (
    <div className="flex items-center border-t border-border-subtle" style={{ borderRadius: 0 }}>
      {visibility.totalWords && (
        <div className="hidden sm:flex flex-col px-4 py-3 shrink-0">
          <span className="text-2xl font-medium text-text-main leading-none">{wordCount}</span>
          <span className="text-[11px] text-text-muted mt-1">{t('header_totalWords')}</span>
        </div>
      )}

      {visibility.totalWords && visibility.sessionWords && (
        <div className="hidden sm:block w-px self-stretch bg-border-subtle" />
      )}

      {visibility.sessionWords && (
        <div
        ref={wordBlockRef}
        className="relative flex flex-col cursor-pointer px-4 py-3 transition-colors hover:bg-text-main/5"
        onClick={() => { setWordPopupOpen(!wordPopupOpen); setTimePopupOpen(false); }}
      >
        <div className="flex items-baseline gap-1.5 leading-none">
          <span className={cn("text-xl sm:text-2xl font-medium", wordDone ? "text-accent-success" : "text-text-main")}>
            {sessionWords}
          </span>
          {wordGoal > 0 && (
            <span className={cn("text-sm sm:text-base", wordDone ? "text-accent-success/70" : "text-text-subtle")}>
              / {wordGoal}
            </span>
          )}
        </div>
        {wordProgress !== null && wordGoal > 0 && (
          <div className="w-full h-1 rounded-full bg-border-subtle mt-1.5">
            <div
              className={cn("h-1 rounded-full transition-all", wordDone ? "bg-accent-success" : "bg-text-main")}
              style={{ width: `${wordProgress}%` }}
            />
          </div>
        )}
        <span className="text-[11px] text-text-muted mt-1">
          {wordGoal > 0 ? t('header_sessionWords') : t('header_sessionWords_hint')}
        </span>

        {wordPopupOpen && (
          <GoalPopup 
            open={wordPopupOpen}
            onClose={() => setWordPopupOpen(false)}
            title={t('goal_popup_words_title')}
            type="words"
            presets={[250, 500, 1000, 1500, 2000].map(p => ({ value: p, label: String(p) }))}
            current={wordGoal}
            onSelect={(v) => onSetWordGoal(v)}
            onClear={() => onSetWordGoal(0)}
            onClearLabel={t('goal_popup_clear')}
            placeholder="1000"
            triggerRef={wordBlockRef}
            width="w-[210px]"
          />
        )}
      </div>
      )}

      {visibility.sessionWords && visibility.sessionTime && (
        <div className="w-px self-stretch bg-border-subtle" />
      )}

      {visibility.sessionTime && (
      <div
        ref={timeBlockRef}
        className="relative flex flex-col cursor-pointer px-4 py-3 transition-colors hover:bg-text-main/5"
        onClick={() => { setTimePopupOpen(!timePopupOpen); setWordPopupOpen(false); }}
      >
        <div className="flex items-baseline gap-1.5 leading-none">
          <span className={cn("text-xl sm:text-2xl font-medium tabular-nums", timeDone ? "text-accent-success" : "text-text-main")}>
            {timerDuration > 0 ? formatTime(timeRemaining) : formatTime(sessionSeconds)}
          </span>
          {timerDuration > 0 && (
            <span className={cn("text-sm sm:text-base", timeDone ? "text-accent-success/70" : "text-text-subtle")}>
              {timeDone ? t('goal_time_done') : t('goal_time_remaining')}
            </span>
          )}
        </div>
        {timeProgress !== null && timerDuration > 0 && (
          <div className="w-full h-1 rounded-full bg-border-subtle mt-1.5">
            <div
              className={cn("h-1 rounded-full transition-all", timeDone ? "bg-accent-success" : "bg-text-main")}
              style={{ width: `${timeProgress}%` }}
            />
          </div>
        )}
        <span className="text-[11px] text-text-muted mt-1">
          {timerDuration > 0
            ? `${t('goal_time_of')} ${Math.round(timerDuration / 60)} ${t('goal_time_min')}`
            : t('header_time_hint')}
        </span>

        {timePopupOpen && (
          <GoalPopup 
            open={timePopupOpen}
            onClose={() => setTimePopupOpen(false)}
            title={t('goal_popup_time_title')}
            type="time"
            presets={[15, 25, 30, 60].map(p => ({ value: p * 60, label: `${p} ${t('goal_time_min')}` }))}
            current={Math.round(timerDuration / 60)}
            currentGoal={Math.round(timerDuration / 60)}
            onSelect={(v) => onSetTimerDuration(v)}
            onClear={() => onSetTimerDuration(0)}
            onClearLabel={t('goal_popup_clear')}
            placeholder="30"
            triggerRef={timeBlockRef}
            width="w-[210px]"
          />
        )}
      </div>
      )}

      {visibility.sessionTime && visibility.wpm && (
        <div className="w-px self-stretch bg-border-subtle" />
      )}

      {visibility.wpm && (
      <div className="flex flex-col shrink-0 px-4 py-3">
        <div className="flex items-center gap-1.5 leading-none">
          <div className={cn("w-2 h-2 rounded-full transition-colors duration-500", getWpmColor(wpm), status === 'writing' && "animate-pulse")} />
          <span className="text-xl sm:text-2xl font-medium text-text-main leading-none">{wpm}</span>
        </div>
        <span className="text-[11px] text-text-muted mt-1">{t('header_wpm')}</span>
      </div>
      )}
          
      {status === 'writing' && (
        <div className="flex items-center gap-1.5 ml-auto px-4">
          <div className="w-2 h-2 rounded-full bg-accent-success animate-pulse" />
          <span className="text-[11px] text-text-subtle font-medium">{t('stats_writing')}</span>
        </div>
      )}
    </div>
  );
});
