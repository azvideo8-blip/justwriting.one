import React, { useState, useEffect, useRef } from 'react';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useShallow } from 'zustand/react/shallow';
import { useWritingSettings } from '../contexts/WritingSettingsContext';
import { useLanguage } from '../../../shared/i18n';
import { formatTime } from '../../../core/utils/formatTime';
import { AnimatePresence, motion } from 'motion/react';
import { MobileFocusScreen } from './MobileFocusScreen';
import { MobileWriteToolbar } from './MobileWriteToolbar';
import { MobileGoalSheet } from './MobileGoalSheet';
import { getFontStack } from '../utils/fontStack';
import { KeystrokeTracker } from '../utils/keystrokeTracker';
import { ConnectionStatusBanner } from './ConnectionStatusBanner';
import { getWpmHex } from '../utils/wpmColors';
import { cn } from '../../../core/utils/utils';
import { useAutoHideCursor } from '../hooks/useAutoHideCursor';
import { getPromptOfDay } from '../utils/promptOfDay';

interface MobileWriteScreenProps {
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onNew?: () => void;
  saveStatus?: string;
  keystrokeTrackerRef?: React.RefObject<KeystrokeTracker>;
}

export function MobileWriteScreen({
  onPlay, onPause, onStop, onNew, saveStatus, keystrokeTrackerRef
}: MobileWriteScreenProps) {
  const { t } = useLanguage();
  const { content, setContent, title, setTitle, wordCount, wpm } = useContentStore(
    useShallow(s => ({
      content: s.content,
      setContent: s.setContent,
      title: s.title,
      setTitle: s.setTitle,
      wordCount: s.wordCount,
      wpm: s.wpm,
    }))
  );
  const { status, seconds, timerDuration, sessionStartSeconds, sessionStartWords } = useTimerStore(
    useShallow(s => ({
      status: s.status,
      seconds: s.seconds,
      timerDuration: s.timerDuration,
      sessionStartSeconds: s.sessionStartSeconds,
      sessionStartWords: s.sessionStartWords,
    }))
  );
  const { fontFamily, fontSize, isZenActive, zenModeEnabled, streamMode, toggleStreamMode, autoHideCursor } = useWritingSettings();

  const sessionSeconds = Math.max(0, seconds - sessionStartSeconds);
  const sessionWords = Math.max(0, wordCount - sessionStartWords);
  const timeRemaining = timerDuration > 0
    ? Math.max(0, timerDuration - sessionSeconds)
    : sessionSeconds;

  const isRunning = status === 'writing';
  const isPaused = status === 'paused';
  const isIdle = status === 'idle';
  const showZen = isZenActive && zenModeEnabled;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!e.metaKey && !e.ctrlKey && !e.altKey && keystrokeTrackerRef?.current) {
      keystrokeTrackerRef.current.record();
    }

    if ((isIdle || isPaused) && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      onPlay();
    }

    if (streamMode) {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'x' || e.key === 'c' || e.key === 'v')) {
        e.preventDefault();
      }
    }
    resetIdleTimer();
  };

  const handleBeforeInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    if (!streamMode) return;
    const inputEvent = e.nativeEvent as InputEvent;
    const inputType = inputEvent.inputType || '';
    if (inputType.includes('delete') || inputType.includes('cut') || inputType.includes('paste')) {
      e.preventDefault();
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
    resetIdleTimer();
  };

  const [focusMode, setFocusMode] = useState(false);
  const [showGoalSheet, setShowGoalSheet] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorAreaRef = useRef<HTMLDivElement>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lighthouseHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lighthouseActive, setLighthouseActive] = useState(false);

  useAutoHideCursor(editorAreaRef, autoHideCursor);

  const resetIdleTimer = () => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (lighthouseHideRef.current) clearTimeout(lighthouseHideRef.current);
    setLighthouseActive(false);
    if (status === 'writing') {
      idleTimerRef.current = setTimeout(() => {
        setLighthouseActive(true);
        lighthouseHideRef.current = setTimeout(() => setLighthouseActive(false), 1500);
      }, 5000);
    }
  };

  useEffect(() => {
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (lighthouseHideRef.current) clearTimeout(lighthouseHideRef.current);
    };
  }, []);
  const swipeTouchStartY = useRef<number>(0);
  const swipeTouchStartX = useRef<number>(0);

  const [keyboardHeight, setKeyboardHeight] = useState(120);
  const [showSwipeHint, setShowSwipeHint] = useState(false);
  const prevMilestoneRef = useRef(0);

  useEffect(() => {
    const sessionWords = wordCount - sessionStartWords;
    const milestone = Math.floor(sessionWords / 100);
    if (milestone > prevMilestoneRef.current && milestone > 0) {
      prevMilestoneRef.current = milestone;
      navigator.vibrate?.(12);
    }
  }, [wordCount, sessionStartWords]);

  useEffect(() => {
    if (status === 'idle') {
      prevMilestoneRef.current = 0;
    }
  }, [status]);

  useEffect(() => {
    const hintShown = localStorage.getItem('focus_swipe_hint_shown');
    if (hintShown) return;
    // hideTimer must be cleared from the effect cleanup — a function returned
    // from inside a setTimeout callback is discarded, not run on unmount
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const showTimer = setTimeout(() => {
      setShowSwipeHint(true);
      hideTimer = setTimeout(() => {
        setShowSwipeHint(false);
        localStorage.setItem('focus_swipe_hint_shown', 'true');
      }, 4000);
    }, 0);
    return () => {
      clearTimeout(showTimer);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const handleResize = () => {
      const vv = window.visualViewport;
      if (!vv) return;
      const offset = window.innerHeight - vv.height;
      const padBottom = offset > 0 ? Math.max(16, offset + 16) : 120;
      setKeyboardHeight(padBottom);
    };
    window.visualViewport.addEventListener('resize', handleResize);
    return () => window.visualViewport?.removeEventListener('resize', handleResize);
  }, []);

  const handleEditorTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    swipeTouchStartY.current = touch.clientY;
    swipeTouchStartX.current = touch.clientX;
  };

  const handleEditorTouchEnd = (e: React.TouchEvent) => {
    const touch = e.changedTouches[0];
    if (!touch) return;
    const deltaY = touch.clientY - swipeTouchStartY.current;
    const deltaX = Math.abs(touch.clientX - swipeTouchStartX.current);
    if (deltaY > 60 && deltaX < 40 && isRunning) {
      setFocusMode(true);
    }
  };

  const fontFamilyStr = getFontStack(fontFamily);

  return (
    <div className="fixed inset-0 bg-[var(--color-surface-base,#0b0d0c)] flex flex-col z-30">
      <ConnectionStatusBanner showZen={showZen} />

      <AnimatePresence>
        {!showZen && (
          <motion.div
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center justify-between px-5 pt-3 pb-2 gap-3 pt-[calc(env(safe-area-inset-top,0px)+12px)]"
          >
            <div className={cn(
              "flex items-center gap-1.5 py-1 px-3 rounded-full border border-[var(--border-light)]",
              isRunning ? "bg-[var(--surface-elevated)]" : "bg-[var(--surface-card)]"
            )}>
              <div className={cn(
                "w-1.5 h-1.5 rounded-full",
                isRunning ? "bg-[var(--brand-primary)] shadow-[0_0_6px_oklch(0.72_0.13_155/0.6)]" : isPaused ? "bg-[var(--accent-warning)]" : "bg-[var(--text-subtle)]"
              )} />
              <span className="font-mono text-[13px] font-medium text-[var(--text-main)] tracking-wide tabular-nums">
                {timerDuration > 0 ? formatTime(timeRemaining) : formatTime(sessionSeconds)}
              </span>
            </div>

            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t('topbar_title_placeholder')}
              inputMode="text"
              enterKeyHint="done"
              className="flex-1 bg-transparent border-none outline-none text-sm font-medium text-[var(--text-muted)] text-center font-sans"
            />

            <div className="text-[10px] font-mono text-[var(--text-subtle)] tracking-[0.06em] uppercase min-w-[60px] text-right tabular-nums">
              {saveStatus === 'saving' ? t('save_status_saving') :
               saveStatus === 'saved'  ? t('save_status_saved')  : ''}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        ref={editorAreaRef}
        className="flex-1 overflow-hidden relative"
        onTouchStart={handleEditorTouchStart}
        onTouchEnd={handleEditorTouchEnd}
      >
        <textarea
          ref={textareaRef}
          value={content}
          onChange={e => { setContent(e.target.value); handleType(); }}
          onKeyDown={handleKeyDown}
          onBeforeInput={handleBeforeInput}
          onCut={e => { if (streamMode) e.preventDefault(); }}
          onCopy={e => { if (streamMode) e.preventDefault(); }}
          onPaste={e => { if (streamMode) e.preventDefault(); }}
          placeholder={content.trim() === '' ? getPromptOfDay(t) : t('writing_placeholder')}
          autoFocus
          inputMode="text"
          className={lighthouseActive ? 'lighthouse-pulse' : ''}
          style={{
            width: '100%',
            height: '100%',
            padding: `16px 24px ${keyboardHeight}px`,
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

        <div className="absolute left-0 right-0 bottom-0 h-0.5 pointer-events-none overflow-hidden">
          <div
            ref={glowBarRef}
            className={cn(
              "h-full w-[60%] ml-[20%] transition-[opacity,margin-left] duration-[600ms] ease-[cubic-bezier(.4,.2,.2,1)] blur-[1px] bg-[linear-gradient(90deg,transparent,var(--flow-pulse-color,var(--brand-primary))_50%,transparent)]",
              isRunning ? "opacity-30" : "opacity-0"
            )}
          />
        </div>
      </div>

      {keyboardHeight > 130 && !showZen && (
        <div className="absolute left-0 right-0 flex items-center justify-center gap-4 h-7 bg-[rgba(14,10,24,0.85)] backdrop-blur-sm z-[35] px-4" style={{
          bottom: keyboardHeight,
          borderTop: '1px solid rgba(165, 131, 232, 0.08)',
        }}>
          <span className="font-mono text-[11px] text-[rgba(240,235,250,0.6)] tabular-nums">
            {sessionWords} {t('home_words_short')}
          </span>
          <span className="w-px h-3 bg-[rgba(165,131,232,0.2)]" />
          <span className="font-mono text-[11px] text-[rgba(240,235,250,0.6)] tabular-nums">
            {timerDuration > 0 ? formatTime(timeRemaining) : formatTime(sessionSeconds)}
          </span>
          <span className="w-px h-3 bg-[rgba(165,131,232,0.2)]" />
          <span className="w-1.5 h-1.5 rounded-full" style={{
            background: getWpmHex(wpm),
            boxShadow: status === 'writing' && wpm > 0 ? `0 0 6px ${getWpmHex(wpm)}` : 'none',
          }} />
        </div>
      )}

      <AnimatePresence>
        {showSwipeHint && isRunning && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute bottom-[100px] left-6 right-6 z-40 bg-[var(--surface-card)] backdrop-blur-md border border-white/10 rounded-xl p-3 flex justify-center pointer-events-none"
          >
            <span className="text-xs text-[var(--text-muted)] font-medium">
              {t('swipe_down_hint')}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!showZen && (
          <MobileWriteToolbar
            onPlay={onPlay}
            onPause={onPause}
            onStop={onStop}
            onNew={onNew}
            onGoalClick={() => setShowGoalSheet(true)}
            streamMode={streamMode}
            onToggleStreamMode={toggleStreamMode}
            keyboardHeight={keyboardHeight}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {focusMode && (
          <MobileFocusScreen onExit={() => setFocusMode(false)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showGoalSheet && (
          <MobileGoalSheet isOpen={showGoalSheet} onClose={() => setShowGoalSheet(false)} />
        )}
      </AnimatePresence>

    </div>
  );
}
