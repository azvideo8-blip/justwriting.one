import React, { useState, useEffect, useRef } from 'react';
import { useWritingStore } from '../store/useWritingStore';
import { useWritingSettings } from '../contexts/WritingSettingsContext';
import { useLanguage } from '../../../core/i18n';
import { formatTime } from '../../../core/utils/formatTime';
import { AnimatePresence, motion } from 'motion/react';

interface MobileWriteScreenProps {
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  saveStatus?: string;
}

export function MobileWriteScreen({
  onPlay, onPause, onStop, saveStatus
}: MobileWriteScreenProps) {
  const { t } = useLanguage();
  const status = useWritingStore(s => s.status);
  const content = useWritingStore(s => s.content);
  const setContent = useWritingStore(s => s.setContent);
  const title = useWritingStore(s => s.title);
  const setTitle = useWritingStore(s => s.setTitle);
  const wordCount = useWritingStore(s => s.wordCount);
  const seconds = useWritingStore(s => s.seconds);
  const wpm = useWritingStore(s => s.wpm);
  const wordGoal = useWritingStore(s => s.wordGoal);
  const timerDuration = useWritingStore(s => s.timerDuration);
  const sessionStartWords = useWritingStore(s => s.sessionStartWords);
  const sessionStartSeconds = useWritingStore(s => s.sessionStartSeconds);
  const { fontFamily, fontSize, isZenActive, zenModeEnabled } = useWritingSettings();

  const sessionWords = wordCount - sessionStartWords;
  const sessionSeconds = Math.max(0, seconds - sessionStartSeconds);
  const timeRemaining = timerDuration > 0
    ? Math.max(0, timerDuration - sessionSeconds)
    : sessionSeconds;

  const isRunning = status === 'writing';
  const isPaused = status === 'paused';
  const isIdle = status === 'idle';
  const showZen = isZenActive && zenModeEnabled;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isIdle && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      onPlay();
    }
  };

  const [intensity, setIntensity] = useState(0);
  useEffect(() => {
    const decay = setInterval(() => setIntensity(i => Math.max(0, i - 0.05)), 200);
    return () => clearInterval(decay);
  }, []);

  const handleType = () => {
    if (isRunning) setIntensity(i => Math.min(1, i + 0.2));
  };

  const fontFamilyStr = fontFamily === 'serif'
    ? 'Lora, Georgia, serif'
    : fontFamily === 'mono'
      ? 'JetBrains Mono, monospace'
      : 'Inter, system-ui, sans-serif';

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'var(--color-surface-base, #0b0d0c)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 30,
    }}>

      <AnimatePresence>
        {!showZen && (
          <motion.div
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 20px 8px',
              paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)',
              gap: 12,
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 12px',
              borderRadius: 999,
              background: isRunning
                ? 'rgba(255,255,255,0.06)'
                : 'rgba(255,255,255,0.03)',
              border: `1px solid ${isRunning ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)'}`,
            }}>
              <div style={{
                width: 6, height: 6,
                borderRadius: '50%',
                background: isRunning
                  ? 'oklch(0.72 0.13 155)'
                  : isPaused ? '#f59e0b' : 'rgba(255,255,255,0.2)',
                boxShadow: isRunning ? '0 0 6px oklch(0.72 0.13 155 / 0.6)' : 'none',
              }} />
              <span style={{
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: 13,
                fontWeight: 500,
                color: 'rgba(232,236,233,0.9)',
                letterSpacing: '.02em',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {timerDuration > 0 ? formatTime(timeRemaining) : formatTime(sessionSeconds)}
              </span>
            </div>

            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t('topbar_title_placeholder')}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                fontSize: 14,
                fontWeight: 500,
                color: 'rgba(232,236,233,0.6)',
                textAlign: 'center',
                fontFamily: 'Inter, system-ui, sans-serif',
              }}
            />

            <div style={{
              fontSize: 10,
              fontFamily: 'JetBrains Mono, monospace',
              color: 'rgba(74,81,77,1)',
              letterSpacing: '.06em',
              textTransform: 'uppercase',
              minWidth: 60,
              textAlign: 'right',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {saveStatus === 'saving' ? t('save_status_saving') :
               saveStatus === 'saved'  ? t('save_status_saved')  : ''}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <textarea
          value={content}
          onChange={e => { setContent(e.target.value); handleType(); }}
          onKeyDown={handleKeyDown}
          placeholder={t('writing_placeholder_beta')}
          autoFocus
          style={{
            width: '100%',
            height: '100%',
            padding: '16px 24px 120px',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            resize: 'none',
            fontFamily: fontFamilyStr,
            fontSize: fontSize || 18,
            lineHeight: 1.7,
            color: 'rgba(232,236,233,0.9)',
            caretColor: 'oklch(0.72 0.13 155)',
            WebkitOverflowScrolling: 'touch',
          }}
        />

        <div style={{
          position: 'absolute',
          left: 0, right: 0, bottom: 0,
          height: 2,
          pointerEvents: 'none',
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            background: 'linear-gradient(90deg, transparent, var(--flow-pulse-color, oklch(0.72 0.13 155)) 50%, transparent)',
            width: '60%',
            marginLeft: `${20 + intensity * 20}%`,
            opacity: isRunning ? 0.3 + intensity * 0.55 : 0,
            transition: 'opacity 0.6s, margin-left 0.6s cubic-bezier(.4,.2,.2,1)',
            filter: 'blur(1px)',
          }} />
        </div>
      </div>

      <AnimatePresence>
        {!showZen && (
          <motion.div
            initial={{ opacity: 1, y: 0 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            style={{
              position: 'absolute',
              left: 16, right: 16,
              bottom: 'calc(env(safe-area-inset-bottom, 16px) + 72px)',
              background: 'rgba(17,20,19,0.92)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              borderRadius: 20,
              border: '1px solid rgba(255,255,255,0.08)',
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 0,
            }}
          >
            <div style={{ flex: 1, display: 'flex', gap: 0 }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 17, fontWeight: 500, color: 'rgba(232,236,233,0.9)', lineHeight: 1 }}>
                  {sessionWords}
                  {wordGoal > 0 && (
                    <span style={{ fontSize: 11, color: 'rgba(138,145,141,1)', marginLeft: 3 }}>
                      /{wordGoal}
                    </span>
                  )}
                </span>
                {wordGoal > 0 && (
                  <div style={{ width: '80%', height: 2, borderRadius: 2, background: 'rgba(255,255,255,0.06)', marginTop: 3 }}>
                    <div style={{
                      height: '100%',
                      borderRadius: 2,
                      background: 'oklch(0.72 0.13 155)',
                      width: `${Math.min(100, Math.round(sessionWords / wordGoal * 100))}%`,
                      transition: 'width 0.3s',
                    }} />
                  </div>
                )}
                <span style={{ fontSize: 9, color: 'rgba(74,81,77,1)', textTransform: 'uppercase', letterSpacing: '.06em', marginTop: wordGoal > 0 ? 1 : 3 }}>
                  {t('header_sessionWords')}
                </span>
              </div>

              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{
                  fontSize: 17, fontWeight: 500,
                  color: 'rgba(232,236,233,0.9)',
                  lineHeight: 1,
                  fontFamily: 'JetBrains Mono, monospace',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {timerDuration > 0 ? formatTime(timeRemaining) : formatTime(sessionSeconds)}
                </span>
                <span style={{ fontSize: 9, color: 'rgba(74,81,77,1)', textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 3 }}>
                  {timerDuration > 0
                    ? `${t('goal_time_of')} ${Math.round(timerDuration / 60)}${t('goal_time_min')}`
                    : t('header_time')}
                </span>
              </div>

              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, lineHeight: 1 }}>
                  <div style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: wpm === 0 ? 'rgba(255,255,255,0.15)'
                      : wpm < 15 ? '#ef4444'
                      : wpm < 25 ? '#f97316'
                      : wpm < 35 ? '#eab308'
                      : wpm < 50 ? '#22c55e'
                      : '#60a5fa',
                    transition: 'background 0.5s',
                    flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 17, fontWeight: 500, color: 'rgba(232,236,233,0.9)' }}>
                    {wpm}
                  </span>
                </div>
                <span style={{ fontSize: 9, color: 'rgba(74,81,77,1)', textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 3 }}>
                  {t('header_wpm')}
                </span>
              </div>
            </div>

            <div style={{ width: 1, height: 36, background: 'rgba(255,255,255,0.06)', margin: '0 12px' }} />

            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={isRunning ? onPause : onPlay}
                style={{
                  width: 40, height: 40,
                  borderRadius: 12,
                  border: `1px solid ${isRunning ? 'rgba(255,255,255,0.15)' : 'oklch(0.72 0.13 155 / 0.4)'}`,
                  background: isRunning ? 'rgba(255,255,255,0.05)' : 'oklch(0.72 0.13 155 / 0.12)',
                  color: isRunning ? 'rgba(232,236,233,0.7)' : 'oklch(0.72 0.13 155)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer',
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
                  border: '1px solid rgba(255,255,255,0.08)',
                  background: 'transparent',
                  color: isIdle ? 'rgba(74,81,77,1)' : 'rgba(232,236,233,0.5)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: isIdle ? 'default' : 'pointer',
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="1.5"/>
                </svg>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
