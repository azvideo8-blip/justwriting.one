import React, { useState, useEffect } from 'react';
import { 
  CheckCircle2, Play, Clock, Plus, History, Pause, Settings, Maximize, Minimize,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../core/utils/utils';
import { useLanguage } from '../../core/i18n';
import { useWritingSettings } from './contexts/WritingSettingsContext';
import { formatTime } from '../../core/utils/formatTime';

import { useWritingStore } from './store/useWritingStore';
import { BetaToolbar } from './components/BetaToolbar';
import { ClassicHeaderStats } from './components/ClassicHeaderStats';
import { GoalPopup } from './components/GoalPopup';

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
  onNew?: () => void;
  onOpenLog?: () => void;
  onSave?: () => void;
  onStop?: () => void;
  onPlay?: () => void;
  onPause?: () => void;
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
  onOpenSettings,
  onNew,
  onOpenLog,
  onSave,
  onStop,
  onPlay,
  onPause
}: WritingHeaderProps) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { t, tp } = useLanguage();
  const { 
    isZenActive, zenModeEnabled, 
    headerVisibility, streamMode,
    betaLifeLog
  } = useWritingSettings();

  const status = useWritingStore(s => s.status);
  const title = useWritingStore(s => s.title);
  const setTitle = useWritingStore(s => s.setTitle);
  const seconds = useWritingStore(s => s.seconds);
  const wpm = useWritingStore(s => s.wpm);
  const wordCount = useWritingStore(s => s.wordCount);
  const sessionStartWords = useWritingStore(s => s.sessionStartWords);
  const sessionStartSeconds = useWritingStore(s => s.sessionStartSeconds);
  const sessionType = useWritingStore(s => s.sessionType);
  const wordGoal = useWritingStore(s => s.wordGoal);
  const timerDuration = useWritingStore(s => s.timerDuration);
  
  const setWordGoal = useWritingStore(s => s.setWordGoal);
  const setTimerDuration = useWritingStore(s => s.setTimerDuration);
  const setStatus = useWritingStore(s => s.setStatus);

  const [wordGoalOpen, setWordGoalOpen] = useState(false);
  const [timeGoalOpen, setTimeGoalOpen] = useState(false);

  const sessionWords = wordCount - sessionStartWords;
  const sessionSeconds = seconds - sessionStartSeconds;

  const showZen = isZenActive && zenModeEnabled;

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

  return (
    <AnimatePresence>
      {!showZen && (
        <motion.div
          initial={{ opacity: 0, y: -16, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -16, height: 0 }}
          transition={{ duration: 0.4, ease: 'easeInOut' }}
          className={cn(
            "w-full z-40 px-4 py-3 overflow-hidden"
          )}
        >
          {betaLifeLog ? (
            <div className="w-full mx-auto flex flex-col gap-0 bg-surface-card backdrop-blur-2xl border border-border-subtle rounded-2xl shadow-sm overflow-hidden">
              <BetaToolbar 
                onNew={onNew}
                onOpenLog={onOpenLog}
                onSave={onSave}
                onPlay={onPlay}
                onPause={onPause}
                onStop={onStop}
                status={status}
                wordCount={wordCount}
                title={title}
                setTitle={setTitle}
              />

              {/* Нижний ряд — статистика */}
              <div className="flex items-center gap-4 md:gap-7 px-4 py-2.5 overflow-x-auto no-scrollbar">
                <div className="flex flex-col gap-0.5 shrink-0">
                  <span className="text-sm md:text-base font-bold text-text-main leading-none">{wordCount}</span>
                  <span className="text-[10px] md:text-[11px] text-text-main/40 whitespace-nowrap">{t('header_totalWords')}</span>
                </div>

                <div className="flex flex-col gap-0.5 shrink-0">
                  <span className="text-sm md:text-base font-bold text-text-main leading-none">{Math.max(0, sessionWords)}</span>
                  <span className="text-[10px] md:text-[11px] text-text-main/40 whitespace-nowrap">{t('header_sessionWords')}</span>
                </div>

                <div className="flex flex-col gap-0.5 shrink-0">
                  <span className="text-sm md:text-base font-bold text-text-main leading-none">{formatTime(sessionSeconds)}</span>
                  <span className="text-[10px] md:text-[11px] text-text-main/40 whitespace-nowrap">{t('header_sessionTime')}</span>
                </div>

                <div className="flex flex-col gap-0.5 shrink-0">
                  <span className="text-sm md:text-base font-bold text-text-main leading-none">{wpm}</span>
                  <span className="text-[10px] md:text-[11px] text-text-main/40 uppercase whitespace-nowrap">wpm</span>
                </div>

                {/* Кнопки + для целей */}
                <div className="ml-auto flex items-center gap-2 shrink-0">
                  <div className="relative">
                    <button
                      onClick={() => setWordGoalOpen(!wordGoalOpen)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs transition-all",
                        wordGoal
                          ? "border-text-main/40 text-text-main"
                          : "border-dashed border-border-subtle text-text-main/40 hover:text-text-main"
                      )}
                    >
                      <Plus size={11} />
                      {wordGoal ? tp('lifelog_words', wordGoal) : t('goal_words_short')}
                    </button>

                    <GoalPopup 
                      open={wordGoalOpen}
                      onClose={() => setWordGoalOpen(false)}
                      title={t('goal_popup_words_title')}
                      presets={[250, 500, 1000, 1500].map(p => ({ value: p, label: String(p) }))}
                      current={wordGoal}
                      onSelect={setWordGoal}
                      onClear={() => setWordGoal(0)}
                      placeholder="500"
                    />
                  </div>

                  <div className="relative">
                    <button
                      onClick={() => setTimeGoalOpen(!timeGoalOpen)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs transition-all",
                        timerDuration
                          ? "border-text-main/40 text-text-main"
                          : "border-dashed border-border-subtle text-text-main/40 hover:text-text-main"
                      )}
                    >
                      <Plus size={11} />
                      {timerDuration ? `${Math.round(timerDuration / 60)} ${t('goal_time_short')}` : t('goal_time_short')}
                    </button>

                    <GoalPopup 
                      open={timeGoalOpen}
                      onClose={() => setTimeGoalOpen(false)}
                      title={t('goal_popup_time_title')}
                      presets={[15, 25, 30, 60].map(p => ({ value: p * 60, label: `${p}м` }))}
                      current={timerDuration}
                      onSelect={setTimerDuration}
                      onClear={() => setTimerDuration(0)}
                      placeholder="30"
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className={cn(
              "w-full mx-auto flex flex-col gap-0 bg-surface-card backdrop-blur-2xl border border-border-subtle shadow-sm",
              "rounded-2xl transition-all duration-300",
              status === 'idle' ? "px-4 py-2.5" : "px-6 py-3"
            )}>
              <div className="flex items-center justify-between gap-6">
                <div className="flex items-center gap-4 md:gap-8 overflow-x-auto no-scrollbar py-1 flex-1">
                  <ClassicHeaderStats 
                    status={status}
                    wpm={wpm}
                    wordCount={wordCount}
                    sessionWords={sessionWords}
                    sessionSeconds={sessionSeconds}
                    currentTime={currentTime}
                    isPrimary={(t) => isPrimary(t === 'time' ? 'sessionTime' : t === 'words' ? 'sessionWords' : 'wpm')}
                    visibility={headerVisibility}
                    streamMode={streamMode}
                  />
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
                        <CheckCircle2 size={18} />
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

                  <div className="w-px h-6 bg-border-subtle mx-1" />

                  <button 
                    onClick={toggleFullscreen}
                    className="p-2.5 rounded-2xl text-text-main/40 hover:text-text-main hover:bg-white/5 transition-all"
                    title={isFullscreen ? t('header_exit_fullscreen') : t('header_fullscreen')}
                  >
                    {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                  </button>
                  <button 
                    onClick={onOpenSettings}
                    className="p-2.5 rounded-2xl text-text-main/40 hover:text-text-main hover:bg-white/5 transition-all"
                    title={t('header_settings')}
                  >
                    <Settings size={18} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
});
