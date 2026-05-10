import React from 'react';
import { useWritingStore } from '../store/useWritingStore';
import { useShallow } from 'zustand/react/shallow';
import { useWritingSettings } from '../contexts/WritingSettingsContext';
import { useLanguage } from '../../../core/i18n';
import { formatTime } from '../../../core/utils/formatTime';
import { getWpmHex } from '../utils/wpmColors';

interface MobileWriteToolbarProps {
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
}

export function MobileWriteToolbar({ onPlay, onPause, onStop }: MobileWriteToolbarProps) {
  const { t } = useLanguage();
  const { wordCount, seconds, wpm, wordGoal, timerDuration, sessionStartWords, sessionStartSeconds, status } = useWritingStore(
    useShallow(s => ({
      wordCount: s.wordCount,
      seconds: s.seconds,
      wpm: s.wpm,
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

  const isRunning = status === 'writing';
  const isIdle = status === 'idle';

  return (
    <div style={{
      position: 'absolute',
      left: 16, right: 16,
      bottom: 'calc(env(safe-area-inset-bottom, 16px) + 72px)',
      background: 'var(--surface-card)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      borderRadius: 20,
      border: '1px solid var(--border-light)',
      padding: '12px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 0,
    }}>
      <div style={{ flex: 1, display: 'flex', gap: 0 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 17, fontWeight: 500, color: 'var(--text-main)', lineHeight: 1 }}>
            {sessionWords}
            {wordGoal > 0 && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 3 }}>
                /{wordGoal}
              </span>
            )}
          </span>
          {wordGoal > 0 && (
            <div style={{ width: '80%', height: 2, borderRadius: 2, background: 'var(--border-light)', marginTop: 3 }}>
              <div style={{
                height: '100%',
                borderRadius: 2,
                background: 'var(--brand-primary)',
                width: `${Math.min(100, Math.round(sessionWords / wordGoal * 100))}%`,
                transition: 'width 0.3s',
              }} />
            </div>
          )}
          <span style={{ fontSize: 9, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em', marginTop: wordGoal > 0 ? 1 : 3 }}>
            {t('header_sessionWords')}
          </span>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
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

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, lineHeight: 1 }}>
            <div style={{
              width: 7, height: 7, borderRadius: '50%',
              background: getWpmHex(wpm),
              transition: 'background 0.5s',
              flexShrink: 0,
            }} />
            <span style={{ fontSize: 17, fontWeight: 500, color: 'var(--text-main)' }}>
              {wpm}
            </span>
          </div>
          <span style={{ fontSize: 9, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 3 }}>
            {t('header_wpm')}
          </span>
        </div>
      </div>

      <div style={{ width: 1, height: 36, background: 'var(--border-light)', margin: '0 12px' }} />

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={isRunning ? onPause : onPlay}
          style={{
            width: 40, height: 40,
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
            width: 40, height: 40,
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
      </div>
    </div>
  );
}
