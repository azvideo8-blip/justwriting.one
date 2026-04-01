import React, { useState, useEffect } from 'react';
import { CheckCircle2, Play, Clock, Settings, Plus, History, Pause, Square, X } from 'lucide-react';
import { cn } from '../../core/utils/utils';
import { CountdownTimer } from './CountdownTimer';
import { useLanguage } from '../../core/i18n';
import { useUI } from '../../contexts/UIContext';
import { useWritingSettings } from './contexts/WritingSettingsContext';

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
  zenModeEnabled?: boolean;
  stickyHeaderEnabled?: boolean;
  headerVisibility: {
    currentTime: boolean;
    sessionTime: boolean;
    sessionWords: boolean;
    totalWords: boolean;
    wpm: boolean;
  };
  streamMode?: boolean;
}

export const WritingHeader = React.memo(function WritingHeader({
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
  stickyHeaderEnabled = true,
  headerVisibility,
  streamMode = false
}: WritingHeaderProps) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const { t } = useLanguage();
  const { uiVersion } = useUI();
  const { isZenActive, zenModeEnabled } = useWritingSettings();
  const isV2 = uiVersion === '2.0';
  const showZen = isZenActive && zenModeEnabled;

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hours = currentTime.getHours().toString().padStart(2, '0');
  const minutes = currentTime.getMinutes().toString().padStart(2, '0');

  return (
    <div className={cn(
      "w-full transition-all duration-1000 z-40 shadow-sm",
      isV2 
        ? "bg-black/40 backdrop-blur-2xl border-b border-white/5" 
        : "bg-white/80 dark:bg-stone-900/80 backdrop-blur-md border border-stone-200 dark:border-stone-800 rounded-3xl",
      stickyHeaderEnabled && "sticky top-16",
      showZen ? "opacity-0 pointer-events-none -translate-y-4" : "opacity-100 translate-y-0"
    )}>
      <div className="w-full mx-auto px-6 py-4 flex items-center justify-between gap-6">
        <div className="flex items-center gap-4 md:gap-8 overflow-x-auto no-scrollbar py-1 flex-1">
          {headerVisibility.currentTime && (
            <div className="flex flex-col shrink-0">
              <span className={cn(
                "font-black uppercase tracking-widest mb-0.5",
                isV2 ? "text-[9px] text-white/50" : "text-[9px] text-stone-400 dark:text-stone-500"
              )}>{t('header_current_time')}</span>
              <span className={cn(
                "font-mono font-black flex items-center",
                isV2 ? "text-lg text-white/80 font-medium" : "text-lg md:text-xl dark:text-stone-100"
              )}>
                {hours}<span className="animate-pulse mx-0.5">:</span>{minutes}
              </span>
            </div>
          )}
          
          {headerVisibility.sessionTime && (
            <div className="flex flex-col shrink-0">
              <span className={cn(
                "font-black uppercase tracking-widest mb-0.5 flex items-center gap-1",
                isV2 ? "text-[9px] text-white/50" : "text-[9px] text-stone-400 dark:text-stone-500"
              )}>
                {sessionType === 'finish-by' ? t('header_remaining_time') : t('header_session_time')} 
                {sessionType === 'timer' && timeGoalReached && <CheckCircle2 size={16} className="text-emerald-500 animate-bounce" />}
              </span>
              <span className={cn(
                "font-mono font-black transition-colors",
                isV2 ? "text-lg text-white/80 font-medium" : "text-lg md:text-xl",
                sessionType === 'timer' && timeGoalReached ? "text-emerald-500" : "dark:text-stone-100"
              )}>
                {sessionType === 'finish-by' && targetTime ? <CountdownTimer targetTime={targetTime} /> : formatTime(seconds)}
              </span>
            </div>
          )}

          {headerVisibility.sessionWords && !streamMode && (
            <div className="flex flex-col shrink-0">
              <span className={cn(
                "font-black uppercase tracking-widest mb-0.5 flex items-center gap-1",
                isV2 ? "text-[9px] text-white/50" : "text-[9px] text-stone-400 dark:text-stone-500"
              )}>
                {t('header_session_words')} 
                {sessionType === 'words' && wordGoalReached && <CheckCircle2 size={16} className="text-emerald-500 animate-bounce" />}
              </span>
              <span className={cn(
                "font-mono font-black transition-colors",
                isV2 ? "text-lg text-white/80 font-medium" : "text-lg md:text-xl",
                sessionType === 'words' && wordGoalReached ? "text-emerald-500" : "dark:text-stone-100"
              )}>
                {Math.max(0, wordCount - initialWordCount)}
                {sessionType === 'words' && <span className="text-xs text-stone-400 ml-1">/ {wordGoal}</span>}
              </span>
            </div>
          )}

          {headerVisibility.totalWords && !streamMode && (
            <div className="flex flex-col shrink-0">
              <span className={cn(
                "font-black uppercase tracking-widest mb-0.5",
                isV2 ? "text-[9px] text-white/50" : "text-[9px] text-stone-400 dark:text-stone-500"
              )}>{t('header_total_words')}</span>
              <span className={cn(
                "font-mono font-black",
                isV2 ? "text-lg text-white/80 font-medium" : "text-lg md:text-xl dark:text-stone-100"
              )}>{wordCount}</span>
            </div>
          )}

          {headerVisibility.wpm && !streamMode && (
            <div className="flex flex-col shrink-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className={cn(
                  "font-black uppercase tracking-widest",
                  isV2 ? "text-[9px] text-white/50" : "text-[9px] text-stone-400 dark:text-stone-500"
                )}>WPM</span>
                {status === 'writing' && (
                  <div className={cn(
                    "w-1.5 h-1.5 rounded-full animate-pulse transition-colors duration-500",
                    wpm === 0 ? "bg-stone-300" : wpm < 10 ? "bg-amber-400" : wpm < 20 ? "bg-lime-400" : "bg-emerald-500"
                  )} />
                )}
              </div>
              <span className={cn(
                "font-mono font-black",
                isV2 ? "text-lg text-white/80 font-medium" : "text-lg md:text-xl dark:text-stone-100"
              )}>{wpm}</span>
            </div>
          )}
          {status === 'writing' && streamMode && (
            <div className="flex items-center gap-2 text-indigo-500 animate-pulse">
              <div className="w-2 h-2 rounded-full bg-indigo-500" />
              <span className="text-[10px] font-black uppercase tracking-widest">{t('header_in_flow')}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {status === 'idle' && (
            <div className="flex gap-1.5">
              <button 
                onClick={handleNewSession}
                className={cn(
                  "p-2.5 rounded-xl shadow-sm hover:scale-105 transition-all",
                  isV2 ? "bg-white/10 text-white hover:bg-white/20" : "bg-white dark:bg-stone-100 text-stone-900 dark:text-stone-900 border border-stone-200 dark:border-stone-800"
                )}
                title={streamMode ? t('header_begin_release') : t('header_new_session')}
                aria-label={streamMode ? t('header_begin_release') : t('header_new_session')}
              >
                {streamMode ? t('header_begin_release') : <Plus size={18} />}
              </button>
              <button 
                onClick={fetchUserSessions}
                disabled={loadingSessions}
                className={cn(
                  "p-2.5 rounded-xl border transition-all disabled:opacity-50",
                  isV2 
                    ? "bg-white/5 border-white/10 text-white hover:bg-white/10" 
                    : "bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-800 text-stone-900 dark:text-stone-100 hover:bg-stone-50 dark:hover:bg-stone-800"
                )}
                title={t('header_continue')}
                aria-label={t('header_continue')}
              >
                <Clock size={18} />
              </button>
              {hasDraft && (
                <button 
                  onClick={() => setStatus('writing')}
                  className={cn(
                    "p-2.5 rounded-xl transition-all",
                    isV2 ? "bg-white/5 text-white hover:bg-white/10" : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700"
                  )}
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
                  className={cn(
                    "p-2.5 rounded-xl border transition-all",
                    isV2 
                      ? "bg-white/5 border-white/10 text-white hover:bg-white/10" 
                      : "bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800"
                  )}
                  title={t('header_pause')}
                  aria-label={t('header_pause')}
                >
                  <Pause size={18} fill="currentColor" />
                </button>
              )}
              {status === 'paused' && (
                <button 
                  onClick={handleStart}
                  className={cn(
                    "p-2.5 rounded-xl border transition-all",
                    isV2 ? "bg-white/5 border-white/10 text-white hover:bg-white/10" : "bg-white dark:bg-stone-100 text-stone-900 dark:text-stone-900 hover:scale-105 border-stone-200 dark:border-stone-800"
                  )}
                  title={t('header_continue_btn')}
                  aria-label={t('header_continue_btn')}
                >
                  <Play size={18} fill="currentColor" />
                </button>
              )}
              <button 
                onClick={handleFinish}
                className={cn(
                  "p-2.5 rounded-xl transition-all hover:scale-105",
                  isV2 ? "bg-white text-black shadow-[0_0_15px_rgba(255,255,255,0.2)]" : "bg-white dark:bg-stone-100 text-stone-900 dark:text-stone-900 shadow-xl border border-stone-200 dark:border-stone-800"
                )}
                title={t('header_finish')}
                aria-label={t('header_finish')}
              >
                <Square size={18} fill="currentColor" />
              </button>
              <button 
                onClick={() => setShowCancelConfirm(true)}
                className={cn(
                  "p-2.5 transition-colors rounded-xl",
                  isV2 ? "text-white/50 hover:text-red-400 hover:bg-white/5" : "text-stone-400 hover:text-red-500"
                )}
                title={t('header_cancel_session')}
                aria-label={t('header_cancel_session')}
              >
                <X size={18} />
              </button>
            </div>
          )}
          <button 
            onClick={() => setShowSettings(true)}
            className={cn(
              "p-2.5 rounded-xl border transition-all",
              isV2 
                ? "bg-white/5 border-white/10 text-white hover:bg-white/10" 
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700"
            )}
            title={t('header_settings')}
            aria-label={t('header_settings')}
          >
            <Settings size={18} />
          </button>
        </div>
      </div>
    </div>
  );
});
