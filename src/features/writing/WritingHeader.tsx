import React, { useState, useEffect } from 'react';
import { CheckCircle2, Play, Clock, Plus, History, Pause, Square, X, Settings, Maximize, Minimize } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../core/utils/utils';
import { CountdownTimer } from './CountdownTimer';
import { useLanguage } from '../../core/i18n';
import { useWritingSettings } from './contexts/WritingSettingsContext';
import { useLocalStorage } from '../../shared/hooks/useLocalStorage';
import { useLayoutMode } from '../../shared/hooks/useLayoutMode';
import { z } from 'zod';
import { formatTime } from '../../core/utils/formatTime';

import { useWritingStore } from './store/useWritingStore';

interface WritingHeaderProps {
  handleNewSession: () => void;
  fetchUserSessions: () => void;
  loadingSessions: boolean;
  hasDraft: boolean;
  handlePause: () => void;
  handleStart: () => void;
  handleFinish: () => void;
  setShowCancelConfirm: (show: boolean) => void;
  totalDurationForDeadline?: number | null;
  onOpenSettings: () => void;
}

export const WritingHeader = React.memo(function WritingHeader({
  handleNewSession,
  fetchUserSessions,
  loadingSessions,
  hasDraft,
  handlePause,
  handleStart,
  handleFinish,
  setShowCancelConfirm,
  totalDurationForDeadline,
  onOpenSettings
}: WritingHeaderProps) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { t } = useLanguage();
  const { 
    isZenActive, zenModeEnabled, 
    stickyPanel, headerVisibility, streamMode 
  } = useWritingSettings();

  const status = useWritingStore(s => s.status);
  const seconds = useWritingStore(s => s.seconds);
  const wpm = useWritingStore(s => s.wpm);
  const wordCount = useWritingStore(s => s.wordCount);
  const sessionStartWords = useWritingStore(s => s.sessionStartWords);
  const sessionStartSeconds = useWritingStore(s => s.sessionStartSeconds);
  const sessionType = useWritingStore(s => s.sessionType);
  const wordGoal = useWritingStore(s => s.wordGoal);
  const targetTime = useWritingStore(s => s.targetTime);
  const timerDuration = useWritingStore(s => s.timerDuration);
  const timeGoalReached = useWritingStore(s => s.timeGoalReached);
  const wordGoalReached = useWritingStore(s => s.wordGoalReached);
  const overtimeSeconds = useWritingStore(s => s.overtimeSeconds);
  const setStatus = useWritingStore(s => s.setStatus);

  const sessionWords = wordCount - sessionStartWords;
  const sessionSeconds = seconds - sessionStartSeconds;

  const showZen = isZenActive && zenModeEnabled;
  const [classicNav] = useLocalStorage('classic-nav', false, z.boolean());
  const { layoutMode } = useLayoutMode();
  const isMobile = layoutMode === 'mobile';

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleChange);
    return () => document.removeEventListener('fullscreenchange', handleChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const isPrimary = (key: string) => {
    if (status === 'idle') return key === 'totalWords';
    if (sessionType === 'words') return key === 'sessionWords';
    return key === 'sessionTime';
  };

  const hours = currentTime.getHours().toString().padStart(2, '0');
  const minutes = currentTime.getMinutes().toString().padStart(2, '0');

  return (
    <AnimatePresence>
      {!showZen && (
        <motion.div
          initial={{ opacity: 0, y: -16, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -16, height: 0 }}
          transition={{ duration: 0.4, ease: 'easeInOut' }}
          className={cn(
            "w-full z-40 px-4 py-3 overflow-hidden",
            (stickyPanel && classicNav) && "sticky top-16"
          )}
        >
          <div className={cn(
            "w-full mx-auto flex flex-col gap-0 bg-surface-card backdrop-blur-2xl border border-border-subtle shadow-sm",
            "rounded-2xl transition-all duration-300",
            status === 'idle' ? "px-4 py-2.5" : "px-6 py-3"
          )}>
            <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-4 md:gap-8 overflow-x-auto no-scrollbar py-1 flex-1">
            {classicNav && headerVisibility.currentTime && status !== 'idle' && (
              <div className="flex flex-col shrink-0">
                <span className="font-black uppercase tracking-widest mb-0.5 text-[11px] text-text-main/50">{t('header_currentTime')}</span>
                <span className="font-mono font-black flex items-center text-lg text-text-main font-medium">
                  {hours}<span className="animate-pulse mx-0.5">:</span>{minutes}
                </span>
              </div>
            )}
            
            {headerVisibility.sessionTime && (!isMobile || isPrimary('sessionTime')) && (status === 'writing' || status === 'paused') && (
              <div className="flex flex-col shrink-0">
                <span className="font-black uppercase tracking-widest mb-0.5 flex items-center gap-1 text-[11px] text-text-main/50">
                  {sessionType === 'timer' && timeGoalReached
                    ? t('header_overtime')
                    : (sessionType === 'timer' || sessionType === 'finish-by')
                      ? t('header_remaining_time')
                      : t('header_sessionTime')
                  } 
                  {sessionType === 'timer' && timeGoalReached && <CheckCircle2 size={16} className="text-emerald-500 animate-bounce" />}
                </span>
                <span className={cn(
                  "font-mono font-black transition-all",
                  isPrimary('sessionTime') ? "text-2xl text-text-main" : "text-base text-text-main/60"
                )}>
                  {sessionType === 'finish-by' && targetTime 
                    ? <CountdownTimer targetTime={targetTime} /> 
                    : sessionType === 'timer'
                      ? timeGoalReached
                        ? <span className="text-emerald-500">+{formatTime(overtimeSeconds)}</span>
                        : formatTime(Math.max(0, timerDuration - sessionSeconds))
                      : formatTime(sessionSeconds)}
                </span>
              </div>
            )}

            {headerVisibility.sessionWords && !isMobile && (status === 'writing' || status === 'paused') && !streamMode && (
              <div className="flex flex-col shrink-0">
                <span className="font-black uppercase tracking-widest mb-0.5 flex items-center gap-1 text-[11px] text-text-main/50">
                  {t('header_sessionWords')} 
                  {sessionType === 'words' && wordGoalReached && <CheckCircle2 size={16} className="text-emerald-500 animate-bounce" />}
                </span>
                <span className={cn(
                  "font-mono font-black transition-all",
                  isPrimary('sessionWords') ? "text-2xl text-text-main" : "text-base text-text-main/60"
                )}>
                  {Math.max(0, sessionWords)}
                  {sessionType === 'words' && <span className="text-xs text-text-main/40 ml-1">/ {wordGoal}</span>}
                </span>
              </div>
            )}

            {headerVisibility.totalWords && (
              status === 'idle' ? (
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-black font-mono text-text-main">
                    {wordCount}
                  </span>
                  <span className="text-xs text-text-main/40 uppercase tracking-widest">
                    {t('header_totalWords')}
                  </span>
                </div>
              ) : !isMobile && !streamMode && (
                <div className="flex flex-col shrink-0">
                  <span className="font-black uppercase tracking-widest mb-0.5 text-[11px] text-text-main/50">{t('header_totalWords')}</span>
                  <span className={cn(
                    "font-mono font-black transition-all",
                    isPrimary('totalWords') ? "text-2xl text-text-main" : "text-base text-text-main/60"
                  )}>{wordCount}</span>
                </div>
              )
            )}

            {headerVisibility.wpm && !isMobile && !streamMode && status !== 'idle' && (
              <div className="flex flex-col shrink-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-black uppercase tracking-widest text-[11px] text-text-main/50">WPM</span>
                  {status === 'writing' && (
                    <div className={cn(
                      "w-1.5 h-1.5 rounded-full animate-pulse transition-colors duration-500",
                      wpm === 0 ? "bg-stone-300" : wpm < 10 ? "bg-amber-400" : wpm < 20 ? "bg-lime-400" : "bg-emerald-500"
                    )} />
                  )}
                </div>
                <span className={cn(
                  "font-mono font-black transition-all",
                  isPrimary('wpm') ? "text-2xl text-text-main" : "text-base text-text-main/60"
                )}>{wpm}</span>
              </div>
            )}
            {status === 'writing' && streamMode && (
              <div className="flex items-center gap-2 text-indigo-500 animate-pulse">
                <div className="w-2 h-2 rounded-full bg-indigo-500" />
                <span className="text-[11px] font-black uppercase tracking-widest">{t('header_in_flow')}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0 ml-auto">
            {status === 'idle' && (
              <div className="flex gap-1.5">
                <button 
                  onClick={handleNewSession}
                  className="p-2.5 rounded-2xl shadow-sm hover:scale-105 transition-all bg-[var(--surface-elevated)] text-text-main hover:bg-white/10 border border-border-subtle"
                  title={t('header_new_session')}
                  aria-label={t('header_new_session')}
                >
                  <Plus size={18} />
                </button>
                <button 
                  onClick={fetchUserSessions}
                  disabled={loadingSessions}
                  className="p-2.5 rounded-2xl border transition-all disabled:opacity-50 bg-[var(--surface-elevated)] border-border-subtle text-text-main hover:bg-white/10"
                  title={t('header_continue')}
                  aria-label={t('header_continue')}
                >
                  <Clock size={18} />
                </button>
                {hasDraft && (
                  <button 
                    onClick={() => setStatus('writing')}
                    className="p-2.5 rounded-2xl transition-all bg-[var(--surface-elevated)] text-text-main/50 hover:bg-white/10"
                    title={t('header_draft')}
                    aria-label={t('header_draft')}
                  >
                    <History size={18} />
                  </button>
                )}
              </div>
            )}
            {(status === 'writing' || status === 'paused') && (
              <div className="flex items-center gap-1.5">
                {status === 'writing' && (
                  <button 
                    onClick={handlePause}
                    className="p-2.5 rounded-2xl border transition-all bg-[var(--surface-elevated)] border-border-subtle text-text-main/70 hover:bg-white/10"
                    title={t('header_pause')}
                    aria-label={t('header_pause')}
                  >
                    <Pause size={18} fill="currentColor" />
                  </button>
                )}
                {status === 'paused' && (
                  <button 
                    onClick={handleStart}
                    className="p-2.5 rounded-2xl border transition-all bg-[var(--surface-elevated)] border-border-subtle text-text-main hover:bg-white/10 hover:scale-105"
                    title={t('header_continue_btn')}
                    aria-label={t('header_continue_btn')}
                  >
                    <Play size={18} fill="currentColor" />
                  </button>
                )}
                <button 
                  onClick={handleFinish}
                  className="p-2.5 rounded-2xl transition-all hover:scale-105 bg-text-main text-surface-base shadow-[0_0_15px_rgba(255,255,255,0.2)]"
                  title={t('header_finish')}
                  aria-label={t('header_finish')}
                >
                  <Square size={18} fill="currentColor" />
                </button>
                <button 
                  onClick={() => setShowCancelConfirm(true)}
                  className="p-2.5 transition-colors rounded-2xl text-text-main/50 hover:text-red-400 hover:bg-[var(--surface-elevated)]"
                  title={t('header_cancel_session')}
                  aria-label={t('header_cancel_session')}
                >
                  <X size={18} />
                </button>
              </div>
            )}
            <button
              onClick={toggleFullscreen}
              className="p-2.5 rounded-2xl border transition-all bg-[var(--surface-elevated)] border-border-subtle text-text-main/50 hover:bg-text-main/10"
              title={isFullscreen ? t('header_exit_fullscreen') : t('header_fullscreen')}
            >
              {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>
            <button
              onClick={onOpenSettings}
              className="p-2.5 rounded-2xl border transition-all bg-[var(--surface-elevated)] border-border-subtle text-text-main/50 hover:bg-text-main/10"
              title={t('nav_settings')}
              aria-label={t('nav_settings')}
            >
              <Settings size={18} />
            </button>
          </div>
        </div>
        {status === 'writing' && (sessionType === 'words' || sessionType === 'timer' || sessionType === 'finish-by') && (
          <div className="h-0.5 w-full bg-border-subtle rounded-full overflow-hidden mt-2">
            <motion.div
              className={cn(
                "h-full rounded-full transition-colors duration-500",
                (wordGoalReached || timeGoalReached) ? "bg-emerald-500" : "bg-text-main/50"
              )}
              animate={{
                width: sessionType === 'words'
                  ? `${Math.min((sessionWords / wordGoal) * 100, 100)}%`
                  : `${Math.min(((sessionType === 'timer'
                      ? sessionSeconds / timerDuration
                      : sessionSeconds / (totalDurationForDeadline || 1)) * 100), 100)}%`
              }}
              transition={{ duration: 0.5 }}
            />
          </div>
        )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
