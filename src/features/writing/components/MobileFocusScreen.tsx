import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useWritingStore } from '../store/useWritingStore';
import { useWritingSettings } from '../contexts/WritingSettingsContext';
import { useLanguage } from '../../../core/i18n';
import { formatTime } from '../../../core/utils/formatTime';
import { getFontStack } from '../utils/fontStack';

interface MobileFocusScreenProps {
  onExit: () => void;
}

export function MobileFocusScreen({ onExit }: MobileFocusScreenProps) {
  const { t } = useLanguage();
  const content = useWritingStore(s => s.content);
  const setContent = useWritingStore(s => s.setContent);
  const seconds = useWritingStore(s => s.seconds);
  const timerDuration = useWritingStore(s => s.timerDuration);
  const sessionStartSeconds = useWritingStore(s => s.sessionStartSeconds);
  const { fontFamily, fontSize } = useWritingSettings();

  const sessionSeconds = Math.max(0, seconds - sessionStartSeconds);
  const timeRemaining = timerDuration > 0
    ? Math.max(0, timerDuration - sessionSeconds)
    : sessionSeconds;

  const [timerVisible, setTimerVisible] = useState(true);
  const timerHideRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showTimerBriefly = () => {
    setTimerVisible(true);
    clearTimeout(timerHideRef.current);
    timerHideRef.current = setTimeout(() => setTimerVisible(false), 2500);
  };

  useEffect(() => {
    timerHideRef.current = setTimeout(() => setTimerVisible(false), 3000);
    return () => clearTimeout(timerHideRef.current);
  }, []);

  const [intensity, setIntensity] = useState(0);
  useEffect(() => {
    const decay = setInterval(() => setIntensity(i => Math.max(0, i - 0.04)), 200);
    return () => clearInterval(decay);
  }, []);

  const touchStartY = useRef<number>(0);
  const touchStartX = useRef<number>(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const deltaY = touchStartY.current - e.changedTouches[0].clientY;
    const deltaX = Math.abs(touchStartX.current - e.changedTouches[0].clientX);
    if (deltaY > 60 && deltaX < 40) {
      onExit();
    }
    if (Math.abs(deltaY) < 10 && deltaX < 10) {
      showTimerBriefly();
    }
  };

  const fontStack = getFontStack(fontFamily);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--color-surface-base, #0b0d0c)',
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <textarea
        value={content}
        onChange={e => {
          setContent(e.target.value);
          setIntensity(i => Math.min(1, i + 0.2));
          showTimerBriefly();
        }}
        autoFocus
        style={{
          flex: 1,
          width: '100%',
          padding: '60px 28px 40px',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          resize: 'none',
          fontFamily: fontStack,
          fontSize: fontSize || 18,
          lineHeight: 1.75,
          color: 'rgba(232,236,233,0.92)',
          caretColor: 'oklch(0.72 0.13 155)',
          WebkitOverflowScrolling: 'touch',
        }}
      />

      <AnimatePresence>
        {timerVisible && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            style={{
              position: 'absolute',
              top: 'calc(env(safe-area-inset-top, 0px) + 16px)',
              right: 20,
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 12,
              color: 'rgba(74,81,77,1)',
              letterSpacing: '.04em',
              pointerEvents: 'none',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {timerDuration > 0 ? formatTime(timeRemaining) : formatTime(sessionSeconds)}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {timerVisible && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            style={{
              position: 'absolute',
              bottom: 'calc(env(safe-area-inset-bottom, 0px) + 90px)',
              left: 0, right: 0,
              display: 'flex',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <div style={{
              fontSize: 11,
              color: 'rgba(74,81,77,0.7)',
              fontFamily: 'JetBrains Mono, monospace',
              letterSpacing: '.04em',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <span>↑</span>
              <span>{t('focus_exit_hint')}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
          opacity: intensity > 0 ? 0.3 + intensity * 0.5 : 0,
          transition: 'opacity 0.5s, margin-left 0.5s cubic-bezier(.4,.2,.2,1)',
          filter: 'blur(1px)',
        }} />
      </div>
    </motion.div>
  );
}
