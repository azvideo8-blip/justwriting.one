import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useWritingSettings } from '../contexts/WritingSettingsContext';
import { useLanguage } from '../../../core/i18n';
import { formatTime } from '../../../core/utils/formatTime';
import { getFontStack } from '../utils/fontStack';

interface MobileFocusScreenProps {
  onExit: () => void;
}

export function MobileFocusScreen({ onExit }: MobileFocusScreenProps) {
  const { t } = useLanguage();
  const content = useContentStore(s => s.content);
  const setContent = useContentStore(s => s.setContent);
  const seconds = useTimerStore(s => s.seconds);
  const timerDuration = useTimerStore(s => s.timerDuration);
  const sessionStartSeconds = useTimerStore(s => s.sessionStartSeconds);
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
  const glowStyle = {
    background: 'linear-gradient(90deg, transparent, var(--flow-pulse-color, var(--brand-primary)) 50%, transparent)',
    marginLeft: `${20 + intensity * 20}%`,
    opacity: intensity > 0 ? 0.3 + intensity * 0.5 : 0,
    transitionTimingFunction: 'cubic-bezier(.4,.2,.2,1)' as const,
    filter: 'blur(1px)',
  };
  useEffect(() => {
    const decay = setInterval(() => setIntensity(i => Math.max(0, i - 0.04)), 200);
    return () => clearInterval(decay);
  }, []);

  const touchStartY = useRef<number>(0);
  const touchStartX = useRef<number>(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0]!.clientY;
    touchStartX.current = e.touches[0]!.clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const touch = e.changedTouches[0];
    if (!touch) return;
    const deltaY = touchStartY.current - touch.clientY;
    const deltaX = Math.abs(touchStartX.current - touch.clientX);
    if (deltaY > 60 && deltaX < 40) {
      onExit();
    }
    if (Math.abs(deltaY) < 10 && deltaX < 10) {
      showTimerBriefly();
    }
  };

  const fontStack = getFontStack(fontFamily);
  const textareaStyle = {
    fontFamily: fontStack,
    fontSize: fontSize || 18,
    lineHeight: 1.75,
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 bg-[var(--color-surface-base,#0b0d0c)] z-40 flex flex-col"
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
        className="flex-1 w-full py-[60px] px-7 pb-10 bg-transparent border-none outline-none resize-none text-[rgba(232,236,233,0.92)] caret-[var(--brand-primary)] touch-pan-y"
        style={textareaStyle}
      />

      <AnimatePresence>
        {timerVisible && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute right-5 font-mono text-xs text-[rgba(74,81,77,1)] tracking-wider pointer-events-none tabular-nums top-[calc(env(safe-area-inset-top,0px)+16px)]"
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
            className="absolute left-0 right-0 flex justify-center pointer-events-none bottom-[calc(env(safe-area-inset-bottom,0px)+90px)]"
          >
            <div className="text-[11px] text-[rgba(74,81,77,0.7)] font-mono tracking-wider flex items-center gap-2">
              <span>↑</span>
              <span>{t('focus_exit_hint')}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute left-0 right-0 bottom-0 h-0.5 pointer-events-none overflow-hidden">
        <div
          className="h-full w-[60%] transition-[opacity,margin-left] duration-500"
          style={glowStyle}
        />
      </div>
    </motion.div>
  );
}
