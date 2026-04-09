import React, { useState, useEffect } from 'react';
import { CheckCircle2, Play, Clock, Settings, Plus, History, Pause, Square, X } from 'lucide-react';
import { cn } from '../../core/utils/utils';
import { CountdownTimer } from './CountdownTimer';
import { useLanguage } from '../../core/i18n';
import { useUI } from '../../contexts/UIContext';
import { useWritingSettings } from './contexts/WritingSettingsContext';

import { useWritingStore } from './store/useWritingStore';

interface WritingHeaderProps {
  formatTime: (s: number) => string;
  handleNewSession: () => void;
  fetchUserSessions: () => void;
  loadingSessions: boolean;
  hasDraft: boolean;
  setShowSettings: (show: boolean) => void;
  handlePause: () => void;
  handleStart: () => void;
  handleFinish: () => void;
  setShowCancelConfirm: (show: boolean) => void;
}

export const WritingHeader = React.memo(function WritingHeader({
  formatTime,
  handleNewSession,
  fetchUserSessions,
  loadingSessions,
  hasDraft,
  setShowSettings,
  handlePause,
  handleStart,
  handleFinish,
  setShowCancelConfirm
}: WritingHeaderProps) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const { t } = useLanguage();
  const { 
    isZenActive, zenModeEnabled, 
    stickyHeader, headerVisibility, streamMode 
  } = useWritingSettings();

  const status = useWritingStore(s => s.status);
  const seconds = useWritingStore(s => s.seconds);
  const wpm = useWritingStore(s => s.wpm);
  const wordCount = useWritingStore(s => s.wordCount);
  const initialWordCount = useWritingStore(s => s.initialWordCount);
  const sessionType = useWritingStore(s => s.sessionType);
  const wordGoal = useWritingStore(s => s.wordGoal);
  const targetTime = useWritingStore(s => s.targetTime);
  const timeGoalReached = useWritingStore(s => s.timeGoalReached);
  const wordGoalReached = useWritingStore(s => s.wordGoalReached);
  const setStatus = useWritingStore(s => s.setStatus);

  const showZen = isZenActive && zenModeEnabled;

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hours = currentTime.getHours().toString().padStart(2, '0');
  const minutes = currentTime.getMinutes().toString().padStart(2, '0');

  return (
    <div className={cn(
      "w-full transition-all duration-1000 z-40 shadow-sm bg-surface-card backdrop-blur-2xl border-b border-border-subtle",
      stickyHeader && "sticky top-16",
      showZen ? "opacity-0 pointer-events-none -translate-y-4" : "opacity-100 translate-y-0"
    )}>
      <div className="w-full mx-auto px-6 py-4 flex items-center justify-between gap-6">
        <div className="flex items-center gap-4 md:gap-8 overflow-x-auto no-scrollbar py-1 flex-1">
          {headerVisibility.currentTime && (
            <div className="flex flex-col shrink-0">
              <span className="font-black uppercase tracking-widest mb-0.5 text-[9px] text-text-main/50">{t('header_current_time')}</span>
              <span className="font-mono font-black flex items-center text-lg text-text-main font-medium">
                {hours}<span className="animate-pulse mx-0.5">:</span>{minutes}
              </span>
            </div>
          )}
          
          {headerVisibility.sessionTime && (
            <div className="flex flex-col shrink-0">
              <span className="font-black uppercase tracking-widest mb-0.5 flex items-center gap-1 text-[9px] text-text-main/50">
                {sessionType === 'finish-by' ? t('header_remaining_time') : t('header_session_time')} 
                {sessionType === 'timer' && timeGoalReached && <CheckCircle2 size={16} className="text-emerald-500 animate-bounce" />}
              </span>
              <span className={cn(
                "font-mono font-black transition-colors text-lg font-medium",
                sessionType === 'timer' && timeGoalReached ? "text-emerald-500" : "text-text-main"
              )}>
                {sessionType === 'finish-by' && targetTime ? <CountdownTimer targetTime={targetTime} /> : formatTime(seconds)}
              </span>
            </div>
          )}

          {headerVisibility.sessionWords && !streamMode && (
            <div className="flex flex-col shrink-0">
              <span className="font-black uppercase tracking-widest mb-0.5 flex items-center gap-1 text-[9px] text-text-main/50">
                {t('header_session_words')} 
                {sessionType === 'words' && wordGoalReached && <CheckCircle2 size={16} className="text-emerald-500 animate-bounce" />}
              </span>
              <span className={cn(
                "font-mono font-black transition-colors text-lg font-medium",
                sessionType === 'words' && wordGoalReached ? "text-emerald-500" : "text-text-main"
              )}>
                {Math.max(0, wordCount - initialWordCount)}
                {sessionType === 'words' && <span className="text-xs text-text-main/40 ml-1">/ {wordGoal}</span>}
              </span>
            </div>
          )}

          {headerVisibility.totalWords && !streamMode && (
            <div className="flex flex-col shrink-0">
              <span className="font-black uppercase tracking-widest mb-0.5 text-[9px] text-text-main/50">{t('header_total_words')}</span>
              <span className="font-mono font-black text-lg text-text-main font-medium">{wordCount}</span>
            </div>
          )}

          {headerVisibility.wpm && !streamMode && (
            <div className="flex flex-col shrink-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-black uppercase tracking-widest text-[9px] text-text-main/50">WPM</span>
                {status === 'writing' && (
                  <div className={cn(
                    "w-1.5 h-1.5 rounded-full animate-pulse transition-colors duration-500",
                    wpm === 0 ? "bg-stone-300" : wpm < 10 ? "bg-amber-400" : wpm < 20 ? "bg-lime-400" : "bg-emerald-500"
                  )} />
                )}
              </div>
              <span className="font-mono font-black text-lg text-text-main font-medium">{wpm}</span>
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
                className="p-2.5 rounded-xl shadow-sm hover:scale-105 transition-all bg-surface-base text-text-main hover:bg-white/10 border border-border-subtle"
                title={streamMode ? t('header_begin_release') : t('header_new_session')}
                aria-label={streamMode ? t('header_begin_release') : t('header_new_session')}
              >
                {streamMode ? t('header_begin_release') : <Plus size={18} />}
              </button>
              <button 
                onClick={fetchUserSessions}
                disabled={loadingSessions}
                className="p-2.5 rounded-xl border transition-all disabled:opacity-50 bg-surface-base border-border-subtle text-text-main hover:bg-white/10"
                title={t('header_continue')}
                aria-label={t('header_continue')}
              >
                <Clock size={18} />
              </button>
              {hasDraft && (
                <button 
                  onClick={() => setStatus('writing')}
                  className="p-2.5 rounded-xl transition-all bg-surface-base text-text-main/50 hover:bg-white/10"
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
                  className="p-2.5 rounded-xl border transition-all bg-surface-base border-border-subtle text-text-main/70 hover:bg-white/10"
                  title={t('header_pause')}
                  aria-label={t('header_pause')}
                >
                  <Pause size={18} fill="currentColor" />
                </button>
              )}
              {status === 'paused' && (
                <button 
                  onClick={handleStart}
                  className="p-2.5 rounded-xl border transition-all bg-surface-base border-border-subtle text-text-main hover:bg-white/10 hover:scale-105"
                  title={t('header_continue_btn')}
                  aria-label={t('header_continue_btn')}
                >
                  <Play size={18} fill="currentColor" />
                </button>
              )}
              <button 
                onClick={handleFinish}
                className="p-2.5 rounded-xl transition-all hover:scale-105 bg-text-main text-surface-base shadow-[0_0_15px_rgba(255,255,255,0.2)]"
                title={t('header_finish')}
                aria-label={t('header_finish')}
              >
                <Square size={18} fill="currentColor" />
              </button>
              <button 
                onClick={() => setShowCancelConfirm(true)}
                className="p-2.5 transition-colors rounded-xl text-text-main/50 hover:text-red-400 hover:bg-white/5"
                title={t('header_cancel_session')}
                aria-label={t('header_cancel_session')}
              >
                <X size={18} />
              </button>
            </div>
          )}
          <button 
            onClick={() => setShowSettings(true)}
            className="p-2.5 rounded-xl border transition-all bg-surface-base border-border-subtle text-text-main/50 hover:bg-white/10"
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
