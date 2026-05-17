import React, { useState, useEffect, useRef } from 'react';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useShallow } from 'zustand/react/shallow';
import { useWritingSettings } from '../contexts/WritingSettingsContext';
import { useLanguage } from '../../../core/i18n';
import { formatTime } from '../../../core/utils/formatTime';
import { AnimatePresence, motion } from 'motion/react';
import { MobileFocusScreen } from './MobileFocusScreen';
import { MobileWriteToolbar } from './MobileWriteToolbar';
import { getFontStack } from '../utils/fontStack';

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
  const { content, setContent, title, setTitle } = useContentStore(
    useShallow(s => ({
      content: s.content,
      setContent: s.setContent,
      title: s.title,
      setTitle: s.setTitle,
    }))
  );
  const { status, seconds, timerDuration, sessionStartSeconds } = useTimerStore(
    useShallow(s => ({
      status: s.status,
      seconds: s.seconds,
      timerDuration: s.timerDuration,
      sessionStartSeconds: s.sessionStartSeconds,
    }))
  );
  const { fontFamily, fontSize, isZenActive, zenModeEnabled } = useWritingSettings();

  const sessionSeconds = Math.max(0, seconds - sessionStartSeconds);
  const timeRemaining = timerDuration > 0
    ? Math.max(0, timerDuration - sessionSeconds)
    : sessionSeconds;

  const isRunning = status === 'writing';
  const isPaused = status === 'paused';
  const isIdle = status === 'idle';
  const showZen = isZenActive && zenModeEnabled;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((isIdle || isPaused) && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      onPlay();
    }
  };

  const intensityRef = useRef(0);
  const glowBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const decay = setInterval(() => {
      intensityRef.current = Math.max(0, intensityRef.current - 0.05);
      const node = glowBarRef.current;
      if (node) {
        node.style.opacity = String(status === 'writing' ? 0.3 + intensityRef.current * 0.55 : 0);
        node.style.marginLeft = `${20 + intensityRef.current * 20}%`;
      }
    }, 200);
    return () => clearInterval(decay);
  }, [status]);

  const handleType = () => {
    if (status === 'writing') {
      intensityRef.current = Math.min(1, intensityRef.current + 0.2);
    }
  };

  const [focusMode, setFocusMode] = useState(false);
  const swipeTouchStartY = useRef<number>(0);
  const swipeTouchStartX = useRef<number>(0);

  const handleEditorTouchStart = (e: React.TouchEvent) => {
    swipeTouchStartY.current = e.touches[0].clientY;
    swipeTouchStartX.current = e.touches[0].clientX;
  };

  const handleEditorTouchEnd = (e: React.TouchEvent) => {
    const deltaY = e.changedTouches[0].clientY - swipeTouchStartY.current;
    const deltaX = Math.abs(e.changedTouches[0].clientX - swipeTouchStartX.current);
    if (deltaY > 60 && deltaX < 40 && isRunning) {
      setFocusMode(true);
    }
  };

  const fontFamilyStr = getFontStack(fontFamily);

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
                ? 'var(--surface-elevated)'
                : 'var(--surface-card)',
              border: `1px solid ${isRunning ? 'var(--border-light)' : 'var(--border-light)'}`,
            }}>
              <div style={{
                width: 6, height: 6,
                borderRadius: '50%',
                background: isRunning
                  ? 'var(--brand-primary)'
                   : isPaused ? '#f59e0b' : 'var(--text-subtle)',
                boxShadow: isRunning ? '0 0 6px oklch(0.72 0.13 155 / 0.6)' : 'none',
              }} />
              <span style={{
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--text-main)',
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
                color: 'var(--text-muted)',
                textAlign: 'center',
                fontFamily: 'Inter, system-ui, sans-serif',
              }}
            />

            <div style={{
              fontSize: 10,
              fontFamily: 'JetBrains Mono, monospace',
              color: 'var(--text-subtle)',
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

      <div
        style={{ flex: 1, overflow: 'hidden', position: 'relative' }}
        onTouchStart={handleEditorTouchStart}
        onTouchEnd={handleEditorTouchEnd}
      >
        <textarea
          value={content}
          onChange={e => { setContent(e.target.value); handleType(); }}
          onKeyDown={handleKeyDown}
          placeholder={t('writing_placeholder')}
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
            color: 'var(--text-main)',
            caretColor: 'var(--brand-primary)',
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
          <div
            ref={glowBarRef}
            style={{
              height: '100%',
              background: 'linear-gradient(90deg, transparent, var(--flow-pulse-color, var(--brand-primary)) 50%, transparent)',
              width: '60%',
              marginLeft: '20%',
              opacity: isRunning ? 0.3 : 0,
              transition: 'opacity 0.6s, margin-left 0.6s cubic-bezier(.4,.2,.2,1)',
              filter: 'blur(1px)',
            }}
          />
        </div>
      </div>

      <AnimatePresence>
        {!showZen && (
          <MobileWriteToolbar onPlay={onPlay} onPause={onPause} onStop={onStop} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {focusMode && (
          <MobileFocusScreen onExit={() => setFocusMode(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
