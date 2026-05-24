import { useRef, useState, useEffect } from 'react';
import { Square } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../../../core/utils/utils';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useShallow } from 'zustand/react/shallow';
import { formatTime } from '../../../core/utils/formatTime';
import { useLanguage } from '../../../core/i18n';
import { getWpmColor, getWpmHex } from '../utils/wpmColors';
import { useWritingSettings } from '../contexts/WritingSettingsContext';
import { GoalPopup } from './GoalPopup';

const PLAY_PATH = "M8 5v14l11-7z";
const PAUSE_PATH = "M6 19h4V5H6v14zm8-14v14h4V5h-4z";

function PlayPauseIcon({ isPlaying, size = 14 }: { isPlaying: boolean; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
      <motion.path
        initial={false}
        animate={{ d: isPlaying ? PAUSE_PATH : PLAY_PATH }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
      />
    </svg>
  );
}

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
  const { wordCount, wpm } = useContentStore(
    useShallow(s => ({
      wordCount: s.wordCount,
      wpm: s.wpm,
    }))
  );
  const { status, seconds, wordGoal, timerDuration, sessionStartWords, sessionStartSeconds, setWordGoal, setTimerDuration } = useTimerStore(
    useShallow(s => ({
      status: s.status,
      seconds: s.seconds,
      wordGoal: s.wordGoal,
      timerDuration: s.timerDuration,
      sessionStartWords: s.sessionStartWords,
      sessionStartSeconds: s.sessionStartSeconds,
      setWordGoal: s.setWordGoal,
      setTimerDuration: s.setTimerDuration,
    }))
  );

  const sessionWords = Math.max(0, wordCount - sessionStartWords);
  const sessionSeconds = seconds - sessionStartSeconds;
  const timeRemaining = timerDuration > 0
    ? Math.max(0, timerDuration - sessionSeconds)
    : sessionSeconds;

  const wordPct = wordGoal > 0
    ? Math.min(100, Math.round(sessionWords / wordGoal * 100))
    : Math.min(100, Math.round(sessionWords / 500 * 100));
  const timePct = timerDuration > 0
    ? Math.min(100, Math.round(sessionSeconds / timerDuration * 100))
    : Math.min(100, Math.round(sessionSeconds / 1800 * 100));
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
      if ((wordRef.current && !wordRef.current.contains(target)) ||
          (timeRef.current && !timeRef.current.contains(target))) {
        setWordPopupOpen(false);
        setTimePopupOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div
      className={cn(
        "border-t border-border-subtle bg-surface-card/50 backdrop-blur-xl flex items-center flex-nowrap h-[64px]",
        compact ? "px-3" : "px-6"
      )}
      style={{
        opacity: showZen ? 0.08 : 1,
        transition: 'opacity .4s ease',
        pointerEvents: showZen ? 'none' : undefined,
      }}
    >

      <div className="flex items-center gap-0 flex-1 min-w-0 overflow-hidden">
        {headerVisibility.totalWords && (
        <div className={cn("flex flex-col", compact ? "pr-3 mr-3" : "pr-5 mr-5")}>
          <span className="text-lg font-medium text-text-main leading-none tabular-nums whitespace-nowrap">
            {wordCount.toLocaleString()}
          </span>
          {!compact && (
            <span className="text-[10px] text-text-main/55 tracking-wide mt-1 hidden sm:block">
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
          className={cn(
            "group flex flex-col cursor-pointer rounded-xl transition-colors hover:bg-text-main/[0.04]",
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
            {!compact && (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
                className="text-text-main/20 group-hover:text-text-main/40 transition-colors self-center mb-0.5">
                <path d="M5 2v4M3 4l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
            )}
          </div>
          {!compact && (
            <div className="w-20 h-[3px] rounded-full bg-border-subtle mt-1.5">
              <motion.div
                initial={{ width: 0 }}
                className={cn("h-[3px] rounded-full", wordDone ? "bg-accent-success progress-glow" : "bg-gradient-to-r from-brand-primary to-brand-soft progress-glow")}
                animate={{ width: `${wordPct}%` }}
                transition={{ type: 'spring', stiffness: 120, damping: 20 }}
              />
            </div>
          )}
          {!compact && (
            <span className="text-[10px] text-text-main/55 tracking-wide mt-1 hidden sm:block">
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
          className={cn(
            "group flex flex-col cursor-pointer rounded-xl transition-colors hover:bg-text-main/[0.04]",
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
          {!compact && (
            <div className="w-20 h-[3px] rounded-full bg-border-subtle mt-1.5">
              <motion.div
                initial={{ width: 0 }}
                className={cn("h-[3px] rounded-full", timeDone ? "bg-accent-success progress-glow" : "bg-gradient-to-r from-brand-primary to-brand-soft progress-glow")}
                animate={{ width: `${timePct}%` }}
                transition={{ type: 'spring', stiffness: 120, damping: 20 }}
              />
            </div>
          )}
          {!compact && (
            <span className="text-[10px] text-text-main/55 tracking-wide mt-1 hidden sm:block">
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
            <div
              className={cn("w-2 h-2 rounded-full transition-all duration-500 shrink-0", getWpmColor(wpm), status === 'writing' && "animate-pulse")}
              style={{ boxShadow: status === 'writing' && wpm > 0 ? `0 0 10px ${getWpmHex(wpm)}` : 'none' }}
            />
            <span className="text-lg font-medium text-text-main tabular-nums">{wpm}</span>
          </div>
          {!compact && (
            <span className="text-[10px] text-text-main/55 tracking-wide mt-1 hidden sm:block">
              {t('header_wpm')}
            </span>
          )}
        </div>
        )}
      </div>

      <div className="flex items-center gap-2 ml-2 shrink-0">
        <div className="w-px h-6 bg-border-subtle" />
        <div className="flex items-center gap-1 bg-text-main/[0.04] rounded-xl px-1 py-0.5">
        <motion.button
          onClick={status === 'writing' ? onPause : onPlay}
          title={status === 'writing' ? t('pause') : t('play')}
          whileTap={{ scale: 0.82 }}
          transition={{ type: 'spring', stiffness: 400, damping: 17 }}
          className={cn(
            "w-8 h-8 flex items-center justify-center transition-all shrink-0",
            status === 'writing'
              ? "text-accent-warning hover:bg-accent-warning/10"
              : "text-text-main hover:bg-text-main/5"
          )}
        >
          <PlayPauseIcon isPlaying={status === 'writing'} />
        </motion.button>
        <motion.button
          onClick={onStop}
          disabled={status === 'idle'}
          title={t('stop')}
          whileTap={{ scale: 0.82 }}
          transition={{ type: 'spring', stiffness: 400, damping: 17 }}
          className={cn(
            "w-8 h-8 flex items-center justify-center transition-all shrink-0",
            status !== 'idle'
              ? "text-accent-danger hover:bg-accent-danger/10"
              : "text-text-main/20 cursor-not-allowed"
          )}
        >
          <Square size={14} />
        </motion.button>
        </div>
      </div>

        {wordPopupOpen && (
          <GoalPopup 
            open={wordPopupOpen}
            onClose={() => setWordPopupOpen(false)}
            title={t('goal_popup_words_title')}
            type="words"
            presets={[250, 500, 1000, 1500, 2000].map(p => ({ value: p, label: String(p) }))}
            current={wordGoal}
            onSelect={v => { setWordGoal(v, wordCount); setWordPopupOpen(false); }}
            onClear={() => { setWordGoal(0, wordCount); setWordPopupOpen(false); }}
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
