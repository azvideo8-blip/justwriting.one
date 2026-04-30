import { useRef, useState, useEffect } from 'react';
import { Play, Pause, Square } from 'lucide-react';
import { cn } from '../../../core/utils/utils';
import { useWritingStore } from '../store/useWritingStore';
import { formatTime } from '../../../core/utils/formatTime';
import { useLanguage } from '../../../core/i18n';
import { getWpmColor } from '../utils/wpmColors';
import { useWritingSettings } from '../contexts/WritingSettingsContext';
import { GoalPopup } from './GoalPopup';

interface BottomStatsProps {
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  compact?: boolean;
}

export function BottomStats({ onPlay, onPause, onStop, compact }: BottomStatsProps) {
  const { t } = useLanguage();
  const { isZenActive, zenModeEnabled, headerVisibility } = useWritingSettings();
  const showZen = isZenActive && zenModeEnabled;
  const status = useWritingStore(s => s.status);
  const wordCount = useWritingStore(s => s.wordCount);
  const seconds = useWritingStore(s => s.seconds);
  const wpm = useWritingStore(s => s.wpm);
  const wordGoal = useWritingStore(s => s.wordGoal);
  const timerDuration = useWritingStore(s => s.timerDuration);
  const sessionStartWords = useWritingStore(s => s.sessionStartWords);
  const sessionStartSeconds = useWritingStore(s => s.sessionStartSeconds);
  const setWordGoal = useWritingStore(s => s.setWordGoal);
  const setTimerDuration = useWritingStore(s => s.setTimerDuration);

  const sessionWords = wordCount - sessionStartWords;
  const sessionSeconds = seconds - sessionStartSeconds;
  const timeRemaining = timerDuration > 0
    ? Math.max(0, timerDuration - sessionSeconds)
    : sessionSeconds;

  const wordPct = wordGoal > 0 ? Math.min(100, Math.round(sessionWords / wordGoal * 100)) : null;
  const timePct = timerDuration > 0 ? Math.min(100, Math.round(sessionSeconds / timerDuration * 100)) : null;
  const wordDone = wordGoal > 0 && sessionWords >= wordGoal;
  const timeDone = timerDuration > 0 && sessionSeconds >= timerDuration;

  const [wordPopupOpen, setWordPopupOpen] = useState(false);
  const [timePopupOpen, setTimePopupOpen] = useState(false);
  const wordRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-goal-popup]')) return;
      if (wordRef.current && !wordRef.current.contains(target) &&
          timeRef.current && !timeRef.current.contains(target)) {
        setWordPopupOpen(false);
        setTimePopupOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (showZen) return null;

  return (
    <div className={cn(
      "border-t border-border-subtle bg-surface-card/50 backdrop-blur-xl flex items-center flex-nowrap h-[64px]",
      compact ? "px-3" : "px-6"
    )}>

      <div className="flex items-center gap-0 flex-1 min-w-0 overflow-hidden">
        {headerVisibility.totalWords && (
        <div className={cn("flex flex-col", compact ? "pr-3 mr-3" : "pr-5 mr-5")}>
          <span className="text-lg font-medium text-text-main leading-none tabular-nums whitespace-nowrap">
            {wordCount.toLocaleString()}
          </span>
          {!compact && (
            <span className="text-[10px] text-text-main/40 uppercase tracking-widest mt-1 hidden sm:block">
              {t('header_totalWords')}
            </span>
          )}
        </div>
        )}

        {headerVisibility.totalWords && headerVisibility.sessionWords && (
          <div className="w-px self-stretch bg-border-subtle" />
        )}

        {headerVisibility.sessionWords && (
        <div
          ref={wordRef}
          onClick={() => { setWordPopupOpen(!wordPopupOpen); setTimePopupOpen(false); }}
          className={cn("flex flex-col cursor-pointer",
            compact ? "pr-3 mr-3 px-2 py-1" : "pr-5 mr-5 px-3 py-1.5"
          )}
        >
          <div className="flex items-baseline gap-1.5 leading-none">
            <span className={cn("text-lg font-medium leading-none tabular-nums whitespace-nowrap", wordDone ? "text-accent-success" : "text-text-main")}>
              {sessionWords}
            </span>
            {wordGoal > 0 && (
              <span className={cn("text-xs", wordDone ? "text-accent-success/60" : "text-text-main/30")}>
                / {wordGoal}
              </span>
            )}
          </div>
          {!compact && wordPct !== null && (
            <div className="w-14 h-px bg-border-subtle mt-1.5">
              <div
                className={cn("h-px transition-all", wordDone ? "bg-accent-success" : "bg-text-main")}
                style={{ width: `${wordPct}%` }}
              />
            </div>
          )}
          {!compact && (
            <span className="text-[10px] text-text-main/40 uppercase tracking-widest mt-1 hidden sm:block">
              {t('header_sessionWords')}
            </span>
          )}
        </div>
        )}

        {headerVisibility.sessionWords && headerVisibility.sessionTime && (
          <div className="w-px self-stretch bg-border-subtle" />
        )}

        {headerVisibility.sessionTime && (
        <div
          ref={timeRef}
          onClick={() => { setTimePopupOpen(!timePopupOpen); setWordPopupOpen(false); }}
          className={cn("flex flex-col cursor-pointer",
            compact ? "pr-3 mr-3 px-2 py-1" : "pr-5 mr-5 px-3 py-1.5"
          )}
        >
          <div className="flex items-baseline gap-1.5 leading-none">
            <span className={cn("text-lg font-medium leading-none tabular-nums whitespace-nowrap", timeDone ? "text-accent-success" : "text-text-main")}>
              {timerDuration > 0 ? formatTime(timeRemaining) : formatTime(sessionSeconds)}
            </span>
            {timerDuration > 0 && (
              <span className={cn("text-xs", timeDone ? "text-accent-success/60" : "text-text-main/30")}>
                {timeDone ? t('goal_time_done') : t('goal_time_remaining')}
              </span>
            )}
          </div>
          {!compact && timePct !== null && (
            <div className="w-14 h-px bg-border-subtle mt-1.5">
              <div
                className={cn("h-px transition-all", timeDone ? "bg-accent-success" : "bg-text-main")}
                style={{ width: `${timePct}%` }}
              />
            </div>
          )}
          {!compact && (
            <span className="text-[10px] text-text-main/40 uppercase tracking-widest mt-1 hidden sm:block">
              {timerDuration > 0
                ? `${t('goal_time_of')} ${Math.round(timerDuration / 60)} ${t('goal_time_min')}`
                : t('header_time')}
            </span>
          )}
        </div>
        )}

        {headerVisibility.sessionTime && headerVisibility.wpm && (
          <div className="w-px self-stretch bg-border-subtle" />
        )}

        {headerVisibility.wpm && (
        <div className={cn("flex flex-col", compact ? "ml-1" : "ml-2")}>
          <div className="flex items-center gap-1.5 leading-none whitespace-nowrap">
            <div className={cn("w-2 h-2 rounded-full transition-colors duration-500 shrink-0", getWpmColor(wpm))} />
            <span className="text-lg font-medium text-text-main tabular-nums">{wpm}</span>
          </div>
          {!compact && (
            <span className="text-[10px] text-text-main/40 uppercase tracking-widest mt-1 hidden sm:block">
              {t('header_wpm')}
            </span>
          )}
        </div>
        )}
      </div>

      <div className="flex items-center gap-2 ml-2 shrink-0">
        <div className="w-px h-6 bg-border-subtle" />
        <button
          onClick={status === 'paused' ? onPlay : status === 'idle' ? onPlay : undefined}
          disabled={status === 'writing'}
          title={t('play')}
          className={cn(
            "w-8 h-8 flex items-center justify-center transition-all shrink-0",
            status !== 'writing'
              ? "text-text-main hover:bg-text-main/5"
              : "text-text-main/20 cursor-not-allowed"
          )}
        >
          <Play size={14} />
        </button>
        <button
          onClick={onPause}
          disabled={status !== 'writing'}
          title={t('pause')}
          className={cn(
            "w-8 h-8 flex items-center justify-center transition-all shrink-0",
            status === 'writing'
              ? "text-accent-warning hover:bg-accent-warning/10"
              : "text-text-main/20 cursor-not-allowed"
          )}
        >
          <Pause size={14} />
        </button>
        <button
          onClick={onStop}
          disabled={status === 'idle'}
          title={t('stop')}
          className={cn(
            "w-8 h-8 flex items-center justify-center transition-all shrink-0",
            status !== 'idle'
              ? "text-accent-danger hover:bg-accent-danger/10"
              : "text-text-main/20 cursor-not-allowed"
          )}
        >
          <Square size={14} />
        </button>
      </div>

        {wordPopupOpen && (
          <GoalPopup 
            open={wordPopupOpen}
            onClose={() => setWordPopupOpen(false)}
            title={t('goal_popup_words_title')}
            type="words"
            presets={[250, 500, 1000, 1500, 2000].map(p => ({ value: p, label: String(p) }))}
            current={wordGoal}
            onSelect={v => { setWordGoal(v); setWordPopupOpen(false); }}
            onClear={() => { setWordGoal(0); setWordPopupOpen(false); }}
            onClearLabel={t('goal_popup_clear')}
            placeholder="1000"
            triggerRef={wordRef}
            width="w-[210px]"
          />
        )}
        {timePopupOpen && (
          <GoalPopup
            open={timePopupOpen}
            onClose={() => setTimePopupOpen(false)}
            title={t('goal_popup_time_title')}
            type="time"
            presets={[15, 25, 30, 60].map(p => ({ value: p * 60, label: `${p}${t('goal_time_min')}` }))}
            current={Math.round(timerDuration / 60)}
            currentGoal={Math.round(timerDuration / 60)}
            onSelect={v => { setTimerDuration(v); setTimePopupOpen(false); }}
            onClear={() => { setTimerDuration(0); setTimePopupOpen(false); }}
            onClearLabel={t('goal_popup_clear')}
            placeholder="30"
            triggerRef={timeRef}
            width="w-[210px]"
          />
        )}
     </div>
  );
}
