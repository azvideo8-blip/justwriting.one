import React, { useState, useEffect } from 'react';
import { 
  Play, Clock, Plus, History, Pause, Settings, Maximize, Minimize,
  X, CheckCircle2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../core/utils/utils';
import { useLanguage } from '../../core/i18n';
import { useWritingSettings } from './contexts/WritingSettingsContext';

import { useWritingStore } from './store/useWritingStore';
import { BetaToolbar } from './components/BetaToolbar';
import { ClassicHeaderStats } from './components/ClassicHeaderStats';
import { BetaHeaderStats } from './components/BetaHeaderStats';
import { useAutoHideChrome } from './hooks/useAutoHideChrome';

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
  const { t } = useLanguage();
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

  const sessionWords = wordCount - sessionStartWords;
  const sessionSeconds = Math.max(0, seconds - sessionStartSeconds);

  const showZen = isZenActive && zenModeEnabled;
  const chromeHidden = useAutoHideChrome();

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
    <div style={{
      opacity: chromeHidden ? 0 : 1,
      transform: chromeHidden ? 'translateY(-8px)' : 'translateY(0)',
      pointerEvents: chromeHidden ? 'none' : 'auto',
      transition: 'opacity 0.25s, transform 0.25s',
    }}>
    <AnimatePresence>
      {!showZen && (
        <motion.div
          initial={{ opacity: 0, y: -16, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -16, height: 0 }}
          transition={{ duration: 0.4, ease: 'easeInOut' }}
          className={cn(
            "w-full z-40 px-4 py-3 overflow-visible"
          )}
        >
          {betaLifeLog ? (
            <div className="w-full mx-auto flex flex-col gap-0 bg-surface-card backdrop-blur-2xl border border-border-subtle rounded-3xl shadow-sm overflow-visible p-3 px-4">
              {/* Верхняя строка — панель инструментов */}
              <div className="flex items-center gap-2 pb-2 border-b border-border-subtle mb-2">
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
              </div>

              {/* Нижняя строка — статистика */}
              <BetaHeaderStats
                wordGoal={wordGoal}
                timerDuration={timerDuration}
                onSetWordGoal={setWordGoal}
                onSetTimerDuration={setTimerDuration}
                sessionWords={sessionWords}
                sessionSeconds={sessionSeconds}
                wordCount={wordCount}
                wpm={wpm}
                status={status}
                currentTime={currentTime}
                visibility={headerVisibility}
              />
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
                          onClick={handleStart}
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
    </div>
  );
});
