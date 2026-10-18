import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useWritingSettings } from '../../../core/settings/WritingSettingsContext';
import { useLanguage } from '../../../shared/i18n';
import { formatTime } from '../../../core/utils/formatTime';
import { getFontStack } from '../utils/fontStack';
import { sessionClockSeconds } from '../utils/sessionModeLabels';

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
  const sessionType = useTimerStore(s => s.sessionType);
  const clockSeconds = sessionClockSeconds(sessionType, timerDuration, sessionSeconds);

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

  // SA-10: полоса свечения живёт в ref и двигается transform — без перерисовки
  // всего экрана пять раз в секунду и без Layout от margin-left.
  const intensityRef = useRef(0);
  const glowRef = useRef<HTMLDivElement>(null);
  const glowStyle = {
    background: 'linear-gradient(90deg, transparent, var(--flow-pulse-color, var(--brand-primary)) 50%, transparent)',
    marginLeft: '20%',
    opacity: 0,
    transitionTimingFunction: 'cubic-bezier(.4,.2,.2,1)' as const,
    filter: 'blur(1px)',
  };
  useEffect(() => {
    const decay = setInterval(() => {
      intensityRef.current = Math.max(0, intensityRef.current - 0.04);
      const node = glowRef.current;
      if (!node) return;
      node.style.opacity = String(intensityRef.current > 0 ? 0.3 + intensityRef.current * 0.5 : 0);
      node.style.transform = `translateX(${(intensityRef.current * 100) / 3}%)`;
    }, 200);
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
    <>
      {/* not-a-modal: fullscreen mobile screen */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="fixed inset-0 bg-surface-base z-40 flex flex-col"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
      <textarea
        value={content}
        onChange={e => {
          setContent(e.target.value);
          intensityRef.current = Math.min(1, intensityRef.current + 0.2);
          showTimerBriefly();
        }}
        autoFocus
        className="flex-1 w-full py-[60px] px-7 pb-10 bg-transparent border-none outline-none resize-none text-text-main caret-[var(--brand-primary)] touch-pan-y"
        style={textareaStyle}
      />

      <AnimatePresence>
        {timerVisible && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute right-5 text-xs text-text-main/60 tracking-wider pointer-events-none tabular-nums top-[calc(env(safe-area-inset-top,0px)+16px)]"
          >
            {formatTime(clockSeconds)}
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
            <div className="text-[11px] text-[var(--text-subtle)] font-mono tracking-wider flex items-center gap-2">
              <span>↑</span>
              <span>{t('focus_exit_hint')}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute left-0 right-0 bottom-0 h-0.5 pointer-events-none overflow-hidden">
        <div
          ref={glowRef}
          className="h-full w-[60%] transition-[opacity,transform] duration-300"
          style={glowStyle}
        />
      </div>
    </motion.div>
    </>
  );
}
