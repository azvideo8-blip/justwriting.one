import React from 'react';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useShallow } from 'zustand/react/shallow';
import { useLanguage } from '../../../core/i18n';
import { formatTime } from '../../../core/utils/formatTime';
import { getWpmHex } from '../utils/wpmColors';
import { useWritingSettings } from '../contexts/WritingSettingsContext';
import { motion, AnimatePresence } from 'motion/react';

function DottedProgress({ pct, color }: { pct: number; color: string }) {
  const n = 16;
  const filled = Math.round(Math.min(1, pct) * n);
  return (
    <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          style={{
            width: 5, height: 5, borderRadius: 3,
            background: i < filled ? color : 'var(--border-light)',
            boxShadow: i === filled - 1 && filled > 0 ? `0 0 5px ${color}` : 'none',
            transition: 'background 0.3s',
            flexShrink: 0,
          }}
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
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', opacity: 0.7 }}>
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
  onGoalClick?: () => void;
  streamMode?: boolean;
  onToggleStreamMode?: () => void;
  onNew?: () => void;
  isRunning?: boolean;
  keyboardHeight?: number;
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
      style={{
        position: 'absolute',
        left: 16, right: 16,
        bottom: keyboardHeight && keyboardHeight > 130
          ? keyboardHeight + 8
          : 'calc(env(safe-area-inset-bottom, 16px) + var(--bottom-nav-height, 72px))',
        background: 'var(--surface-card)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderRadius: 20,
        border: streamMode ? '1px solid #ef4444' : '1px solid var(--border-light)',
        boxShadow: streamMode ? '0 0 12px rgba(239, 68, 68, 0.2)' : 'none',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        transition: 'border-color 0.3s, box-shadow 0.3s',
      }}
    >
      {streamMode && (
        <div style={{
          position: 'absolute',
          top: -20,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#ef4444',
          color: '#fff',
          fontSize: 9,
          fontWeight: 'bold',
          padding: '2px 8px',
          borderRadius: 99,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          pointerEvents: 'none',
          boxShadow: '0 2px 4px rgba(239, 68, 68, 0.2)',
        }}>
          {t('stream_mode_label') || 'Stream Mode'}
        </div>
      )}
      <div style={{ flex: 1, display: 'flex', gap: 0 }}>
        {headerVisibility.sessionWords && (
          <div
            onClick={onGoalClick}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
            role="button"
            aria-label={t('writing_mode_words')}
          >
            <span style={{ fontSize: 17, fontWeight: 500, color: 'var(--text-main)', lineHeight: 1 }}>
              {sessionWords}
              {wordGoal > 0 && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 3 }}>
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
            <span style={{ fontSize: 9, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em', marginTop: wordGoal > 0 ? 1 : 3 }}>
              {t('header_sessionWords')}
            </span>
          </div>
        )}

        {headerVisibility.sessionTime && (
          <div
            onClick={onGoalClick}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
            role="button"
            aria-label={t('writing_mode_timer')}
          >
            <span style={{
              fontSize: 17, fontWeight: 500,
              color: 'var(--text-main)',
              lineHeight: 1,
              fontFamily: 'JetBrains Mono, monospace',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {timerDuration > 0 ? formatTime(timeRemaining) : formatTime(sessionSeconds)}
            </span>
            <span style={{ fontSize: 9, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 3 }}>
              {timerDuration > 0
                ? `${t('goal_time_of')} ${Math.round(timerDuration / 60)}${t('goal_time_min')}`
                : t('header_time')}
            </span>
          </div>
        )}

        {headerVisibility.wpm && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, lineHeight: 1 }}>
              <div style={{
                width: 7, height: 7, borderRadius: '50%',
                background: getWpmHex(wpm),
                transition: 'background 0.5s, box-shadow 0.5s',
                flexShrink: 0,
                boxShadow: status === 'writing' && wpm > 0
                  ? `0 0 8px ${getWpmHex(wpm)}`
                  : 'none',
              }} />
              <span style={{ fontSize: 17, fontWeight: 500, color: 'var(--text-main)' }}>
                {wpm}
              </span>
            </div>
            <MiniSpark history={wpmHistory} color={getWpmHex(wpm)} />
            <span style={{ fontSize: 9, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 3 }}>
              {t('header_wpm')}
            </span>
          </div>
        )}
      </div>

      <div style={{ width: 1, height: 36, background: 'var(--border-light)', margin: '0 12px' }} />

      <div style={{ display: 'flex', gap: 6 }}>

        <button
          onClick={isRunning ? onPause : onPlay}
          style={{
            width: 44, height: 44,
            borderRadius: 12,
            border: `1px solid ${isRunning ? 'var(--border-light)' : 'var(--flow-pulse-color, var(--brand-primary) / 0.4)'}`,
            background: isRunning ? 'var(--surface-card)' : 'var(--flow-pulse-color, var(--brand-primary) / 0.12)',
            color: isRunning ? 'var(--text-main)' : 'var(--flow-pulse-color, var(--brand-primary))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            opacity: isRunning ? 0.7 : 1,
          }}
        >
          {isRunning ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="7" y="5" width="4" height="14" rx="1"/>
              <rect x="13" y="5" width="4" height="14" rx="1"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          )}
        </button>

        <button
          onClick={onStop}
          disabled={isIdle}
          style={{
            width: 44, height: 44,
            borderRadius: 12,
            border: '1px solid var(--border-light)',
            background: 'transparent',
            color: isIdle ? 'var(--text-subtle)' : 'var(--text-muted)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: isIdle ? 'default' : 'pointer',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="1.5"/>
          </svg>
        </button>

        {onNew && isIdle && (
          <button
            onClick={onNew}
            style={{
              width: 44, height: 44,
              borderRadius: 12,
              border: '1px solid var(--border-light)',
              background: 'transparent',
              color: 'var(--text-muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              marginLeft: 4,
            }}
            title={t('topbar_new') || "Новая заметка"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        )}
      </div>

      <AnimatePresence>
        {showExitConfirm && (
          <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm">
            <div className="absolute inset-0" onClick={() => setShowExitConfirm(false)} />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="relative z-10 w-full max-w-lg bg-surface-card border-t border-white/[0.06] rounded-t-[28px] overflow-hidden flex flex-col p-6 space-y-6 shadow-[0_-8px_32px_rgba(0,0,0,0.4)]"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 16px) + 16px)' }}
            >
              <div className="flex justify-center">
                <div className="w-12 h-1.5 rounded-full bg-white/10" />
              </div>
              <div className="text-center space-y-2">
                <h3 className="text-lg font-bold text-text-main">
                  {t('stream_mode_exit_confirm') || 'Exit Stream Mode?'}
                </h3>
                <p className="text-sm text-text-main/55">
                  {t('stream_mode_exit_desc') || 'Вы вернетесь к обычному режиму написания.'}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowExitConfirm(false)}
                  className="flex-1 py-3.5 rounded-2xl border border-border-subtle text-text-main font-bold text-sm bg-transparent cursor-pointer active:scale-98 transition-all min-h-[44px]"
                >
                  {t('writing_cancel') || 'Cancel'}
                </button>
                <button
                  onClick={() => {
                    setShowExitConfirm(false);
                    onToggleStreamMode?.();
                  }}
                  className="flex-1 py-3.5 rounded-2xl bg-accent-danger text-white font-bold text-sm border-none cursor-pointer active:scale-98 transition-all min-h-[44px]"
                >
                  {t('storage_delete_confirm') || 'Exit'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
