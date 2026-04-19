import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Play, Pause, Square } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../../core/utils/utils';
import { useWritingStore } from '../store/useWritingStore';
import { formatTime } from '../../../core/utils/formatTime';
import { useLanguage } from '../../../core/i18n';
import { getWpmColor } from '../utils/wpmColors';

interface BetaBottomStatsProps {
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  compact?: boolean;
}

export function BetaBottomStats({ onPlay, onPause, onStop, compact }: BetaBottomStatsProps) {
  const { t } = useLanguage();
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
  const [wordPos, setWordPos] = useState({ top: 0, left: 0 });
  const [timePos, setTimePos] = useState({ top: 0, left: 0 });
  const wordRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);

  const openWordPopup = () => {
    if (wordRef.current) {
      const r = wordRef.current.getBoundingClientRect();
      setWordPos({ top: r.top - 8, left: r.left });
    }
    setWordPopupOpen(true);
    setTimePopupOpen(false);
  };

  const openTimePopup = () => {
    if (timeRef.current) {
      const r = timeRef.current.getBoundingClientRect();
      setTimePos({ top: r.top - 8, left: r.left });
    }
    setTimePopupOpen(true);
    setWordPopupOpen(false);
  };

  const closePopups = () => {
    setWordPopupOpen(false);
    setTimePopupOpen(false);
  };

  const GoalPopup = ({
    pos, presets, current, onSelect, onClear, title, inputPlaceholder, toSeconds
  }: {
    pos: { top: number; left: number };
    presets: { value: number; label: string }[];
    current: number;
    onSelect: (v: number) => void;
    onClear: () => void;
    title: string;
    inputPlaceholder: string;
    toSeconds?: boolean;
  }) => createPortal(
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.95 }}
      style={{
        position: 'fixed',
        top: pos.top,
        left: Math.min(pos.left, window.innerWidth - 220),
        transform: 'translateY(-100%)',
        zIndex: 9999,
      }}
      className="bg-surface-card border border-border-subtle rounded-2xl p-3 w-[210px] shadow-lg"
      onMouseDown={e => e.stopPropagation()}
    >
      <div className="text-[11px] text-text-main/40 mb-2">{title}</div>
      <div className="flex gap-1 flex-wrap mb-2">
        {presets.map(p => (
          <button
            key={p.value}
            onMouseDown={() => { onSelect(p.value); }}
            className={cn(
              "px-2 py-1 rounded-lg text-xs border transition-all",
              current === p.value
                ? "bg-text-main text-surface-base border-text-main"
                : "border-border-subtle text-text-main/60 hover:text-text-main"
            )}
          >{p.label}</button>
        ))}
      </div>
      <div className="flex gap-2 items-center">
        <input
          type="number"
          autoFocus
          placeholder={inputPlaceholder}
          defaultValue={current > 0 ? (toSeconds ? Math.round(current / 60) : current) : ''}
          className="flex-1 bg-surface-base border border-border-subtle rounded-xl px-2 py-1.5 text-sm text-text-main outline-none focus:border-text-main/30"
          onKeyDown={e => {
            if (e.key === 'Enter') {
              const v = parseInt((e.target as HTMLInputElement).value);
              if (v > 0) onSelect(toSeconds ? v * 60 : v);
            }
            if (e.key === 'Escape') closePopups();
          }}
        />
        {current > 0 && (
          <button
            onMouseDown={onClear}
            className="text-[11px] text-text-main/40 hover:text-text-main transition-colors whitespace-nowrap"
          >{t('goal_popup_clear')}</button>
        )}
      </div>
    </motion.div>,
    document.body
  );

  return (
    <div className={cn(
      "border-t border-border-subtle bg-surface-card/50 backdrop-blur-xl flex items-center flex-nowrap flex-shrink-0 min-h-[52px] overflow-x-auto",
      compact ? "px-3 py-2 gap-3" : "px-6 py-3 gap-0"
    )}>

      <div className={cn("flex flex-col", compact ? "pr-3 mr-3 border-r border-border-subtle" : "pr-5 mr-5 border-r border-border-subtle")}>
        <span className="text-lg font-medium text-text-main leading-none tabular-nums whitespace-nowrap">
          {wordCount.toLocaleString()}
        </span>
        {!compact && (
          <span className="text-[10px] text-text-main/40 uppercase tracking-widest mt-1 hidden sm:block">
            {t('header_totalWords')}
          </span>
        )}
      </div>

      <div
        ref={wordRef}
        onClick={openWordPopup}
        className={cn("flex flex-col cursor-pointer rounded-xl hover:bg-text-main/5 transition-colors",
          compact ? "pr-3 mr-3 border-r border-border-subtle px-2 py-1" : "pr-5 mr-5 border-r border-border-subtle px-3 py-1.5 -mx-1"
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
          <div className="w-14 h-[2px] rounded-full bg-border-subtle mt-1.5">
            <div
              className={cn("h-[2px] rounded-full transition-all", wordDone ? "bg-accent-success" : "bg-text-main")}
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

      <div
        ref={timeRef}
        onClick={openTimePopup}
        className={cn("flex flex-col cursor-pointer rounded-xl hover:bg-text-main/5 transition-colors",
          compact ? "pr-3 mr-3 border-r border-border-subtle px-2 py-1" : "pr-5 mr-5 border-r border-border-subtle px-3 py-1.5 -mx-1"
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
          <div className="w-14 h-[2px] rounded-full bg-border-subtle mt-1.5">
            <div
              className={cn("h-[2px] rounded-full transition-all", timeDone ? "bg-accent-success" : "bg-text-main")}
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

      <div className="flex items-center gap-2 ml-auto shrink-0">
        <button
          onClick={status === 'paused' ? onPlay : status === 'idle' ? onPlay : undefined}
          disabled={status === 'writing'}
          title={t('beta_play')}
          className={cn(
            "w-8 h-8 rounded-xl border flex items-center justify-center transition-all",
            status !== 'writing'
              ? "border-text-main/30 text-text-main hover:bg-text-main/5"
              : "border-border-subtle text-text-main/20 cursor-not-allowed"
          )}
        >
          <Play size={13} fill="currentColor" />
        </button>
        <button
          onClick={onPause}
          disabled={status !== 'writing'}
          title={t('beta_pause')}
          className={cn(
            "w-8 h-8 rounded-xl border flex items-center justify-center transition-all",
            status === 'writing'
              ? "border-text-main/30 text-text-main hover:bg-text-main/5"
              : "border-border-subtle text-text-main/20 cursor-not-allowed"
          )}
        >
          <Pause size={13} fill="currentColor" />
        </button>
        <button
          onClick={onStop}
          disabled={status === 'idle'}
          title={t('beta_stop')}
          className={cn(
            "w-8 h-8 rounded-xl border flex items-center justify-center transition-all",
            status !== 'idle'
              ? "border-text-main/30 text-text-main hover:bg-text-main/5"
              : "border-border-subtle text-text-main/20 cursor-not-allowed"
          )}
        >
          <Square size={13} fill="currentColor" />
        </button>
      </div>

      <AnimatePresence>
        {wordPopupOpen && (
          <GoalPopup
            pos={wordPos}
            title={t('goal_popup_words_title')}
            presets={[250, 500, 1000, 1500, 2000].map(p => ({ value: p, label: String(p) }))}
            current={wordGoal}
            onSelect={v => { setWordGoal(v); setWordPopupOpen(false); }}
            onClear={() => { setWordGoal(0); setWordPopupOpen(false); }}
            inputPlaceholder="1000"
          />
        )}
        {timePopupOpen && (
          <GoalPopup
            pos={timePos}
            title={t('goal_popup_time_title')}
            presets={[15, 25, 30, 60].map(p => ({ value: p * 60, label: `${p}м` }))}
            current={timerDuration}
            onSelect={v => { setTimerDuration(v); setTimePopupOpen(false); }}
            onClear={() => { setTimerDuration(0); setTimePopupOpen(false); }}
            inputPlaceholder="30"
            toSeconds
          />
        )}
      </AnimatePresence>
    </div>
  );
}
