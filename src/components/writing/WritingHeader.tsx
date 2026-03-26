import React, { useState, useEffect } from 'react';
import { CheckCircle2, Play, Clock, Settings, Plus, History, Pause, Square, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { CountdownTimer } from './CountdownTimer';
import { useLanguage } from '../../lib/i18n';

interface WritingHeaderProps {
  status: 'idle' | 'writing' | 'paused' | 'finished';
  sessionType: 'stopwatch' | 'timer' | 'words' | 'finish-by';
  timeGoalReached: boolean;
  wordGoalReached: boolean;
  seconds: number;
  wordCount: number;
  initialWordCount: number;
  wordGoal: number;
  targetTime: string | null;
  wpm: number;
  formatTime: (s: number) => string;
  handleNewSession: () => void;
  fetchUserSessions: () => void;
  loadingSessions: boolean;
  hasDraft: boolean;
  setStatus: (status: 'idle' | 'writing' | 'paused' | 'finished') => void;
  setShowSettings: (show: boolean) => void;
  handlePause: () => void;
  handleStart: () => void;
  handleFinish: () => void;
  setShowCancelConfirm: (show: boolean) => void;
  isZenActive?: boolean;
  stickyHeaderEnabled?: boolean;
  headerVisibility: {
    currentTime: boolean;
    sessionTime: boolean;
    sessionWords: boolean;
    totalWords: boolean;
    wpm: boolean;
  };
}

export function WritingHeader({
  status,
  sessionType,
  timeGoalReached,
  wordGoalReached,
  seconds,
  wordCount,
  initialWordCount,
  wordGoal,
  targetTime,
  wpm,
  formatTime,
  handleNewSession,
  fetchUserSessions,
  loadingSessions,
  hasDraft,
  setStatus,
  setShowSettings,
  handlePause,
  handleStart,
  handleFinish,
  setShowCancelConfirm,
  isZenActive = false,
  stickyHeaderEnabled = true,
  headerVisibility
}: WritingHeaderProps) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const { t } = useLanguage();

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hours = currentTime.getHours().toString().padStart(2, '0');
  const minutes = currentTime.getMinutes().toString().padStart(2, '0');

  return (
    <div className={cn(
      "w-full bg-white/80 dark:bg-stone-900/80 backdrop-blur-md border border-stone-200 dark:border-stone-800 z-40 shadow-sm transition-all duration-1000 rounded-3xl",
      stickyHeaderEnabled && "sticky top-16",
      isZenActive ? "opacity-0 pointer-events-none -translate-y-4" : "opacity-100 translate-y-0"
    )}>
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-6">
        <div className="flex items-center gap-4 md:gap-8 overflow-x-auto no-scrollbar py-1 flex-1">
          {headerVisibility.currentTime && (
            <div className="flex flex-col shrink-0">
              <span className="text-[9px] font-black text-stone-400 dark:text-stone-500 uppercase tracking-widest mb-0.5">{t('header_current_time')}</span>
              <span className="text-lg md:text-xl font-mono font-black dark:text-stone-100 flex items-center">
                {hours}<span className="animate-pulse mx-0.5">:</span>{minutes}
              </span>
            </div>
          )}
          
          {headerVisibility.sessionTime && (
            <div className="flex flex-col shrink-0">
              <span className="text-[9px] font-black text-stone-400 dark:text-stone-500 uppercase tracking-widest mb-0.5 flex items-center gap-1">
                {sessionType === 'finish-by' ? t('header_remaining_time') : t('header_session_time')} 
                {sessionType === 'timer' && timeGoalReached && <CheckCircle2 size={10} className="text-emerald-500" />}
              </span>
              <span className={cn(
                "text-lg md:text-xl font-mono font-black transition-colors",
                sessionType === 'timer' && timeGoalReached ? "text-emerald-500" : "dark:text-stone-100"
              )}>
                {sessionType === 'finish-by' && targetTime ? <CountdownTimer targetTime={targetTime} /> : formatTime(seconds)}
              </span>
            </div>
          )}

          {headerVisibility.sessionWords && (
            <div className="flex flex-col shrink-0">
              <span className="text-[9px] font-black text-stone-400 dark:text-stone-500 uppercase tracking-widest mb-0.5 flex items-center gap-1">
                {t('header_session_words')} 
                {sessionType === 'words' && wordGoalReached && <CheckCircle2 size={10} className="text-emerald-500" />}
              </span>
              <span className={cn(
                "text-lg md:text-xl font-mono font-black transition-colors",
                sessionType === 'words' && wordGoalReached ? "text-emerald-500" : "dark:text-stone-100"
              )}>
                {Math.max(0, wordCount - initialWordCount)}
                {sessionType === 'words' && <span className="text-xs text-stone-400 ml-1">/ {wordGoal}</span>}
              </span>
            </div>
          )}

          {headerVisibility.totalWords && (
            <div className="flex flex-col shrink-0">
              <span className="text-[9px] font-black text-stone-400 dark:text-stone-500 uppercase tracking-widest mb-0.5">{t('header_total_words')}</span>
              <span className="text-lg md:text-xl font-mono font-black dark:text-stone-100">{wordCount}</span>
            </div>
          )}

          {headerVisibility.wpm && (
            <div className="flex flex-col shrink-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[9px] font-black text-stone-400 dark:text-stone-500 uppercase tracking-widest">WPM</span>
                {status === 'writing' && (
                  <div className={cn(
                    "w-1.5 h-1.5 rounded-full animate-pulse transition-colors duration-500",
                    wpm === 0 ? "bg-stone-300" : wpm < 10 ? "bg-amber-400" : wpm < 20 ? "bg-lime-400" : "bg-emerald-500"
                  )} />
                )}
              </div>
              <span className="text-lg md:text-xl font-mono font-black dark:text-stone-100">{wpm}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {status === 'idle' && (
            <div className="flex gap-1.5">
              <button 
                onClick={handleNewSession}
                className="p-2.5 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 shadow-sm hover:scale-105 transition-all"
                title={t('header_new_session')}
              >
                <Plus size={18} />
              </button>
              <button 
                onClick={fetchUserSessions}
                disabled={loadingSessions}
                className="p-2.5 rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-stone-900 dark:text-stone-100 hover:bg-stone-50 dark:hover:bg-stone-800 transition-all disabled:opacity-50"
                title={t('header_continue')}
              >
                <Clock size={18} />
              </button>
              {hasDraft && (
                <button 
                  onClick={() => setStatus('writing')}
                  className="p-2.5 rounded-xl bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700 transition-all"
                  title={t('header_draft')}
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
                  className="p-2.5 rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800 transition-all"
                  title={t('header_pause')}
                >
                  <Pause size={18} fill="currentColor" />
                </button>
              )}
              {status === 'paused' && (
                <button 
                  onClick={handleStart}
                  className="p-2.5 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:scale-105 transition-all"
                  title={t('header_continue_btn')}
                >
                  <Play size={18} fill="currentColor" />
                </button>
              )}
              <button 
                onClick={handleFinish}
                className="p-2.5 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:scale-105 transition-all"
                title={t('header_finish')}
              >
                <Square size={18} fill="currentColor" />
              </button>
              <button 
                onClick={() => setShowCancelConfirm(true)}
                className="p-2.5 text-stone-400 hover:text-red-500 transition-colors"
                title={t('header_cancel_session')}
              >
                <X size={18} />
              </button>
            </div>
          )}
          <button 
            onClick={() => setShowSettings(true)}
            className="p-2.5 rounded-xl bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700 transition-all"
            title={t('header_settings')}
          >
            <Settings size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
