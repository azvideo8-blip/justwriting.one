import React, { useState, useRef, useEffect } from 'react';
import { cn } from '../../../core/utils/utils';
import { useLanguage } from '../../../core/i18n';
import { formatTime } from '../../../core/utils/formatTime';
import { GoalPopup } from './GoalPopup';
import { getWpmColor } from '../utils/wpmColors';
import { HeaderVisibility } from '../contexts/WritingSettingsContext';

interface BetaHeaderStatsProps {
  wordGoal: number;
  timerDuration: number;
  onSetWordGoal: (v: number) => void;
  onSetTimerDuration: (v: number) => void;
  sessionWords: number;
  sessionSeconds: number;
  wordCount: number;
  wpm: number;
  status: 'idle' | 'writing' | 'paused';
  currentTime: Date;
  visibility: HeaderVisibility;
}

export const BetaHeaderStats = React.memo(function BetaHeaderStats({
  wordGoal, timerDuration, onSetWordGoal, onSetTimerDuration,
  sessionWords, sessionSeconds, wordCount, wpm, status,
  currentTime, visibility
}: BetaHeaderStatsProps) {
  const { t } = useLanguage();
  
  const [wordPopupOpen, setWordPopupOpen] = useState(false);
  const [timePopupOpen, setTimePopupOpen] = useState(false);
  
  const wordBlockRef = useRef<HTMLDivElement>(null);
  const timeBlockRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        wordBlockRef.current && !wordBlockRef.current.contains(e.target as Node) &&
        timeBlockRef.current && !timeBlockRef.current.contains(e.target as Node)
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
    <div className="flex items-center gap-0">
      {/* Всего слов */}
      {visibility.totalWords && (
        <div className="flex flex-col pr-4 mr-4 border-r border-border-subtle shrink-0">
          <span className="text-2xl font-medium text-text-main leading-none">{wordCount}</span>
          <span className="text-[11px] text-text-main/50 mt-1">{t('header_totalWords')}</span>
        </div>
      )}

      {/* Слов в сессии — кликабельный */}
      {visibility.sessionWords && (
        <div
        ref={wordBlockRef}
        className="relative flex flex-col pr-4 mr-4 border-r border-border-subtle shrink-0 cursor-pointer rounded-xl px-3 py-1.5 -mx-1 transition-colors hover:bg-text-main/5"
        onClick={() => { setWordPopupOpen(!wordPopupOpen); setTimePopupOpen(false); }}
      >
        <div className="flex items-baseline gap-1.5 leading-none">
          <span className={cn("text-2xl font-medium", wordDone ? "text-emerald-400" : "text-text-main")}>
            {sessionWords}
          </span>
          {wordGoal > 0 && (
            <span className={cn("text-base", wordDone ? "text-emerald-400/70" : "text-text-main/40")}>
              / {wordGoal}
            </span>
          )}
        </div>
        {wordProgress !== null && wordGoal > 0 && (
          <div className="w-full h-1 rounded-full bg-border-subtle mt-1.5">
            <div
              className={cn("h-1 rounded-full transition-all", wordDone ? "bg-emerald-400" : "bg-text-main")}
              style={{ width: `${wordProgress}%` }}
            />
          </div>
        )}
        <span className="text-[11px] text-text-main/50 mt-1">
          {wordGoal > 0 ? t('header_sessionWords') : t('header_sessionWords_hint')}
        </span>

        {wordPopupOpen && (
          <GoalPopup 
            open={wordPopupOpen}
            onClose={() => setWordPopupOpen(false)}
            title={t('goal_popup_words_title')}
            type="words"
            presets={[250, 500, 1000, 1500].map(p => ({ value: p, label: String(p) }))}
            current={wordGoal}
            onSelect={(v) => onSetWordGoal(v)}
            onClear={() => onSetWordGoal(0)}
            onClearLabel={t('goal_popup_clear')}
            placeholder="500"
            triggerRef={wordBlockRef}
            width="w-[210px]"
          />
        )}
      </div>
      )}

      {/* Время — кликабельный */}
      {visibility.sessionTime && (
      <div
        ref={timeBlockRef}
        className="relative flex flex-col pr-4 mr-4 border-r border-border-subtle shrink-0 cursor-pointer rounded-xl px-3 py-1.5 -mx-1 transition-colors hover:bg-text-main/5"
        onClick={() => { setTimePopupOpen(!timePopupOpen); setWordPopupOpen(false); }}
      >
        <div className="flex items-baseline gap-1.5 leading-none">
          <span className={cn("text-2xl font-medium font-mono", timeDone ? "text-emerald-400" : "text-text-main")}>
            {timerDuration > 0 ? formatTime(timeRemaining) : formatTime(sessionSeconds)}
          </span>
          {timerDuration > 0 && (
            <span className={cn("text-base", timeDone ? "text-emerald-400/70" : "text-text-main/40")}>
              {timeDone ? t('goal_time_done') : t('goal_time_remaining')}
            </span>
          )}
        </div>
        {timeProgress !== null && timerDuration > 0 && (
          <div className="w-full h-1 rounded-full bg-border-subtle mt-1.5">
            <div
              className={cn("h-1 rounded-full transition-all", timeDone ? "bg-emerald-400" : "bg-text-main")}
              style={{ width: `${timeProgress}%` }}
            />
          </div>
        )}
        <span className="text-[11px] text-text-main/50 mt-1">
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

      {/* WPM — некликабельный */}
      {visibility.wpm && (
      <div className="flex flex-col shrink-0 px-3 py-1.5">
        <div className="flex items-center gap-1.5 leading-none">
          <div className={cn("w-2 h-2 rounded-full transition-colors duration-500", getWpmColor(wpm), status === 'writing' && "animate-pulse")} />
          <span className="text-2xl font-medium text-text-main leading-none">{wpm}</span>
        </div>
        <span className="text-[11px] text-text-main/50 mt-1">{t('header_wpm')}</span>
      </div>
      )}
          
      {/* Индикатор записи */}
      {status === 'writing' && (
        <div className="flex items-center gap-1.5 ml-auto">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[11px] text-text-main/40 font-medium">{t('stats_writing')}</span>
        </div>
      )}
    </div>
  );
});
