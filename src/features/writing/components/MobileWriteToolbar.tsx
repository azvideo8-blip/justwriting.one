import React from 'react';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useShallow } from 'zustand/react/shallow';
import { useLanguage } from '../../../shared/i18n';
import { formatTime } from '../../../core/utils/formatTime';
import { getWpmHex } from '../utils/wpmColors';
import { useWritingSettings } from '../contexts/WritingSettingsContext';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../../core/utils/utils';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';

function DottedProgress({ pct, color }: { pct: number; color: string }) {
  const n = 16;
  const filled = Math.round(Math.min(1, pct) * n);
  const dotStyle = (i: number, filled: number, color: string) => ({
    background: i < filled ? color : 'var(--border-light)',
    boxShadow: i === filled - 1 && filled > 0 ? `0 0 5px ${color}` : 'none',
  });
  return (
    <div className="flex gap-0.5 mt-1" >
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          className="w-[5px] h-[5px] rounded-[3px] shrink-0 transition-colors duration-300"
          style={dotStyle(i, filled, color)}
        />
      ))}
    </div>
  );
}

function MiniSpark({ history, color }: { history: { timestamp: number; wpm: number }[]; color: string }) {
  const pts = history.slice(-12);
  if (pts.length < 2) return null;
  const maxWpm = Math.max(...pts.map(p => p.wpm), 1);
  const w = 44, h = 16;
  const points = pts.map((p, i) => {
    const x = (i / (pts.length - 1)) * w;
    const y = h - (p.wpm / maxWpm) * h;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block opacity-70" >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface MobileWriteToolbarProps {
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onGoalClick?: (() => void) | undefined;
  streamMode?: boolean | undefined;
  onToggleStreamMode?: (() => void) | undefined;
  onNew?: (() => void) | undefined;
  isRunning?: boolean | undefined;
  keyboardHeight?: number | undefined;
}

export function MobileWriteToolbar({
  onPlay, onPause, onStop, onGoalClick, streamMode, onToggleStreamMode, onNew, keyboardHeight
}: MobileWriteToolbarProps) {
  const { t } = useLanguage();
  const { headerVisibility = { sessionTime: true, sessionWords: true, totalWords: true, wpm: true } } = useWritingSettings();
  const { wordCount, wpm, wpmHistory } = useContentStore(
    useShallow(s => ({
      wordCount: s.wordCount,
      wpm: s.wpm,
      wpmHistory: s.wpmHistory,
    }))
  );
  const { seconds, wordGoal, timerDuration, sessionStartWords, sessionStartSeconds, status } = useTimerStore(
    useShallow(s => ({
      seconds: s.seconds,
      wordGoal: s.wordGoal,
      timerDuration: s.timerDuration,
      sessionStartWords: s.sessionStartWords,
      sessionStartSeconds: s.sessionStartSeconds,
      status: s.status,
    }))
  );

  const sessionWords = wordCount - sessionStartWords;
  const sessionSeconds = Math.max(0, seconds - sessionStartSeconds);
  const timeRemaining = timerDuration > 0
    ? Math.max(0, timerDuration - sessionSeconds)
    : sessionSeconds;

  const [showExitConfirm, setShowExitConfirm] = React.useState(false);
  const isRunning = status === 'writing';
  const isIdle = status === 'idle';
  const wpmHex = getWpmHex(wpm);
  const wpmDotStyle = {
    background: wpmHex,
    boxShadow: status === 'writing' && wpm > 0
      ? `0 0 8px ${wpmHex}`
      : 'none',
  };
  const toolbarStyle = {
    bottom: keyboardHeight && keyboardHeight > 130
      ? `${keyboardHeight + 8}px`
      : 'calc(env(safe-area-inset-bottom, 16px) + var(--bottom-nav-height, 72px))',
    border: streamMode ? '1px solid var(--accent-danger)' : '1px solid var(--border-light)',
    boxShadow: streamMode ? '0 0 12px color-mix(in srgb, var(--accent-danger) 20%, transparent)' : 'none',
  };

  const longPressTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTouchStart = () => {
    if (!streamMode || !onToggleStreamMode) return;
    longPressTimer.current = setTimeout(() => {
      setShowExitConfirm(true);
    }, 3000);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
  };

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchEnd}
      className="absolute left-4 right-4 bg-[var(--surface-card)] backdrop-blur-md rounded-[20px] py-3 px-4 flex items-center gap-0 transition-[border-color,box-shadow] duration-300"
      style={toolbarStyle}
    >
      {streamMode && (
        <div className="absolute -top-5 left-1/2 -translate-x-1/2 bg-[var(--accent-danger)] text-[var(--bg-base)] text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-[0.05em] pointer-events-none shadow-[0_2px_4px_color-mix(in_srgb,var(--accent-danger)_20%,transparent)]">
          {t('stream_mode_label') || 'Stream Mode'}
        </div>
      )}
      <div className="flex-1 flex gap-0">
        {headerVisibility.sessionWords && (
          <div
            onClick={onGoalClick}
            className="flex-1 flex flex-col gap-px cursor-pointer [-webkit-tap-highlight-color:transparent]" 
            role="button"
            tabIndex={0}
            aria-label={t('writing_mode_words')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onGoalClick?.(); } }}
          >
            <span className="text-[17px] font-medium text-[var(--text-main)] leading-none">
              {sessionWords}
              {wordGoal > 0 && (
                <span className="text-[11px] text-[var(--text-muted)] ml-0.5">
                  /{wordGoal}
                </span>
              )}
            </span>
            {wordGoal > 0 && (
              <DottedProgress
                pct={sessionWords / wordGoal}
                color={getWpmHex(wpm)}
              />
            )}
            <span className={cn("text-[9px] text-[var(--text-subtle)] uppercase tracking-[0.06em]", wordGoal > 0 ? "mt-px" : "mt-[3px]")}>
              {t('header_sessionWords')}
            </span>
          </div>
        )}

        {headerVisibility.sessionTime && (
          <div
            onClick={onGoalClick}
            className="flex-1 flex flex-col gap-px cursor-pointer [-webkit-tap-highlight-color:transparent]" 
            role="button"
            tabIndex={0}
            aria-label={t('writing_mode_timer')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onGoalClick?.(); } }}
          >
            <span className="text-[17px] font-medium text-[var(--text-main)] leading-none font-mono tabular-nums">
              {timerDuration > 0 ? formatTime(timeRemaining) : formatTime(sessionSeconds)}
            </span>
            <span className="text-[9px] text-[var(--text-subtle)] uppercase tracking-[0.06em] mt-0.5">
              {timerDuration > 0
                ? `${t('goal_time_of')} ${Math.round(timerDuration / 60)}${t('goal_time_min')}`
                : t('header_time')}
            </span>
          </div>
        )}

        {headerVisibility.wpm && (
          <div className="flex-1 flex flex-col gap-px" >
            <div className="flex items-center gap-1.25 leading-none">
              <div
                className="w-[7px] h-[7px] rounded-full shrink-0 transition-[background,box-shadow] duration-500"
                style={wpmDotStyle}
              />
              <span className="text-[17px] font-medium text-[var(--text-main)]">
                {wpm}
              </span>
            </div>
            <MiniSpark history={wpmHistory} color={getWpmHex(wpm)} />
            <span className="text-[9px] text-[var(--text-subtle)] uppercase tracking-[0.06em] mt-0.5">
              {t('header_wpm')}
            </span>
          </div>
        )}
      </div>

      <div className="w-px h-9 bg-[var(--border-light)] mx-3" />

      <div className="flex gap-1.5" >

        <IconButton
          onClick={isRunning ? onPause : onPlay}
          label={isRunning ? t('pause') : t('play')}
          className={cn(
            "w-11 h-11 rounded-xl flex items-center justify-center cursor-pointer border",
            isRunning ? "border-[var(--border-light)] bg-[var(--surface-card)] text-[var(--text-main)] opacity-70" : "border-[var(--flow-pulse-color,var(--brand-primary)/0.4)] bg-[var(--flow-pulse-color,var(--brand-primary)/0.12)] text-[var(--flow-pulse-color,var(--brand-primary))] opacity-100"
          )}
          icon={isRunning ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="7" y="5" width="4" height="14" rx="1"/>
              <rect x="13" y="5" width="4" height="14" rx="1"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          )}
        />

        <IconButton
          onClick={onStop}
          disabled={isIdle}
          label={t('stop')}
          className={cn(
            "w-11 h-11 rounded-xl border border-[var(--border-light)] bg-transparent flex items-center justify-center",
            isIdle ? "text-[var(--text-subtle)] cursor-default" : "text-[var(--text-muted)] cursor-pointer"
          )}
          icon={
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="1.5"/>
            </svg>
          }
        />

        {onNew && isIdle && (
          <IconButton
            onClick={onNew}
            label={t('topbar_new') || "Новая заметка"}
            className="w-11 h-11 rounded-xl border border-[var(--border-light)] bg-transparent text-[var(--text-muted)] flex items-center justify-center cursor-pointer ml-1"
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            }
          />
        )}
      </div>

      <AnimatePresence>
        {showExitConfirm && (
          <div className="fixed inset-0 z-[var(--z-sheet)] flex items-end justify-center bg-black/60 backdrop-blur-sm">
            <div className="absolute inset-0" onClick={() => setShowExitConfirm(false)} />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="relative z-10 w-full max-w-lg bg-surface-card border-t border-white/[0.06] rounded-t-[28px] overflow-hidden flex flex-col p-6 space-y-6 shadow-[0_-8px_32px_rgba(0,0,0,0.4)] pb-[calc(env(safe-area-inset-bottom,16px)+16px)]"
            >
              <div className="flex justify-center">
                <div className="w-12 h-1.5 rounded-full bg-white/10" />
              </div>
              <div className="text-center space-y-2">
                <h3 className="text-lg font-bold text-text-main">
                  {t('stream_mode_exit_confirm') || 'Exit Stream Mode?'}
                </h3>
                <p className="text-sm text-text-main/60">
                  {t('stream_mode_exit_desc') || 'Вы вернетесь к обычному режиму написания.'}
                </p>
              </div>
              <div className="flex gap-3">
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => setShowExitConfirm(false)}
                  className="flex-1 py-3.5 rounded-2xl border border-border-subtle text-text-main font-bold text-sm min-h-[44px]"
                >
                  {t('writing_cancel') || 'Cancel'}
                </Button>
                <Button
                  variant="danger"
                  size="md"
                  onClick={() => {
                    setShowExitConfirm(false);
                    onToggleStreamMode?.();
                  }}
                  className="flex-1 py-3.5 rounded-2xl font-bold text-sm text-white min-h-[44px]"
                >
                  {t('storage_delete_confirm') || 'Exit'}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
