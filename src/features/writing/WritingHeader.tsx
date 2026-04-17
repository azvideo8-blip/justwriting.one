import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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

function GoalPopupPortal({
  pos, type, currentGoal, presets,
  onSelect, onClear, onClose, title,
  clearLabel
}: {
  pos: { top: number; left: number };
  type: 'words' | 'time';
  currentGoal: number;
  presets: { value: number; label: string }[];
  onSelect: (v: number) => void;
  onClear: () => void;
  onClose: () => void;
  title: string;
  clearLabel: string;
}) {
  return createPortal(
    <div
      style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
      className="bg-surface-card border border-border-subtle rounded-2xl p-3 w-[210px] shadow-lg"
      onMouseDown={e => e.stopPropagation()}
    >
      <div className="text-[11px] text-text-main/40 mb-2">{title}</div>
      <div className="flex gap-1 flex-wrap mb-2">
        {presets.map(p => (
          <button
            key={p.value}
            onMouseDown={e => { e.stopPropagation(); onSelect(p.value); onClose(); }}
            className={cn(
              "px-2 py-1 rounded-lg text-xs border transition-all",
              (type === 'words' ? currentGoal === p.value : currentGoal === Math.round(p.value / 60))
                ? "bg-text-main text-surface-base border-text-main"
                : "border-border-subtle text-text-main/60 hover:text-text-main hover:border-text-main/30"
            )}
          >{p.label}</button>
        ))}
      </div>
      <div className="flex gap-2 items-center">
        <input
          type="number"
          autoFocus
          defaultValue={currentGoal > 0 ? currentGoal : ''}
          placeholder={type === 'words' ? '500' : '30'}
          className="flex-1 bg-surface-base border border-border-subtle rounded-xl px-2 py-1.5 text-sm text-text-main outline-none focus:border-text-main/30 w-16"
          onKeyDown={e => {
            if (e.key === 'Enter') {
              const v = parseInt((e.target as HTMLInputElement).value);
              if (v > 0) { onSelect(type === 'words' ? v : v * 60); onClose(); }
            }
            if (e.key === 'Escape') onClose();
          }}
        />
        {currentGoal > 0 && (
          <button
            onMouseDown={e => { e.stopPropagation(); onClear(); onClose(); }}
            className="text-[11px] text-text-main/40 hover:text-text-main transition-colors whitespace-nowrap"
          >{clearLabel}</button>
        )}
      </div>
    </div>,
    document.body
  );
}

function getWpmColor(wpm: number): string {
  if (wpm === 0) return 'bg-text-main/20';      // серый
  if (wpm < 15)  return 'bg-red-500';           // красный
  if (wpm < 25)  return 'bg-orange-500';        // оранжевый
  if (wpm < 35)  return 'bg-yellow-500';        // жёлтый
  if (wpm < 50)  return 'bg-emerald-500';       // зелёный
  return 'bg-blue-400';                          // синий — очень быстро
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
  const setStatus = useWritingStore(s => s.setStatus);

  const [wordPopupOpen, setWordPopupOpen] = useState(false);
  const [timePopupOpen, setTimePopupOpen] = useState(false);
  const [wordPopupPos, setWordPopupPos] = useState({ top: 0, left: 0 });
  const [timePopupPos, setTimePopupPos] = useState({ top: 0, left: 0 });

  const wordBlockRef = useRef<HTMLDivElement>(null);
  const timeBlockRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        wordBlockRef.current && !wordBlockRef.current.contains(e.target as Node) &&
        timeBlockRef.current && !timeBlockRef.current.contains(e.target as Node)
      ) {
        setWordPopupOpen(false);
        setTimePopupOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleWordClick = () => {
    if (wordBlockRef.current) {
      const rect = wordBlockRef.current.getBoundingClientRect();
      setWordPopupPos({
        top: rect.bottom + 8,
        left: rect.left,
      });
    }
    setWordPopupOpen(!wordPopupOpen);
    setTimePopupOpen(false);
  };

  const handleTimeClick = () => {
    if (timeBlockRef.current) {
      const rect = timeBlockRef.current.getBoundingClientRect();
      setTimePopupPos({
        top: rect.bottom + 8,
        left: rect.left,
      });
    }
    setTimePopupOpen(!timePopupOpen);
    setWordPopupOpen(false);
  };

  const sessionWords = wordCount - sessionStartWords;
  const sessionSeconds = Math.max(0, seconds - sessionStartSeconds);
  const timeRemaining = timerDuration > 0 ? Math.max(0, timerDuration - sessionSeconds) : sessionSeconds;
  const wordProgress = wordGoal > 0 ? Math.min(100, Math.round(sessionWords / wordGoal * 100)) : null;
  const timeProgress = timerDuration > 0 ? Math.min(100, Math.round(sessionSeconds / timerDuration * 100)) : null;
  const wordDone = wordGoal > 0 && sessionWords >= wordGoal;
  const timeDone = timerDuration > 0 && sessionSeconds >= timerDuration;

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
            "w-full z-40 px-4 py-3 overflow-visible"
          )}
        >
          {betaLifeLog ? (
            <div className="w-full mx-auto flex flex-col gap-0 bg-surface-card backdrop-blur-2xl border border-border-subtle rounded-3xl shadow-sm overflow-visible p-3 px-6">
              {/* Верхняя строка — панель инструментов */}
              <div className="flex items-center gap-2 pb-3 border-b border-border-subtle/50 mb-3">
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
              <div className="flex items-center gap-0">
                {/* Всего слов — некликабельный */}
                <div className="flex flex-col pr-4 mr-4 border-r border-border-subtle shrink-0">
                  <span className="text-2xl font-medium text-text-main leading-none">{wordCount}</span>
                  <span className="text-[11px] text-text-main/50 mt-1">{t('header_totalWords')}</span>
                </div>

                {/* Слов в сессии — кликабельный */}
                <div
                  ref={wordBlockRef}
                  className="relative flex flex-col pr-4 mr-4 border-r border-border-subtle shrink-0 cursor-pointer rounded-xl px-3 py-1.5 -mx-1 transition-colors hover:bg-text-main/5"
                  onClick={handleWordClick}
                >
                  <div className="flex items-baseline gap-1.5 leading-none">
                    <span className={cn("text-2xl font-medium", wordDone ? "text-emerald-400" : "text-text-main")}>
                      {sessionWords}
                    </span>
                    {wordGoal > 0 && (
                      <span className={cn("text-base", wordDone ? "text-emerald-400/70" : "text-text-main/40")}>
                        / {wordGoal}
                      </span>
                    )}
                  </div>
                  {wordProgress !== null && wordGoal > 0 && (
                    <div className="w-full h-[2px] rounded-full bg-border-subtle mt-1.5">
                      <div
                        className={cn("h-[2px] rounded-full transition-all", wordDone ? "bg-emerald-400" : "bg-text-main")}
                        style={{ width: `${wordProgress}%` }}
                      />
                    </div>
                  )}
                  <span className="text-[11px] text-text-main/50 mt-1">
                    {wordGoal > 0 ? t('header_sessionWords') : t('header_sessionWords_hint')}
                  </span>

                  {wordPopupOpen && (
                    <GoalPopupPortal 
                      pos={wordPopupPos}
                      type="words"
                      currentGoal={wordGoal}
                      presets={[250, 500, 1000, 1500].map(p => ({ value: p, label: String(p) }))}
                      onSelect={(v) => setWordGoal(v)}
                      onClear={() => setWordGoal(0)}
                      onClose={() => setWordPopupOpen(false)}
                      title={t('goal_popup_words_title')}
                      clearLabel={t('goal_popup_clear')}
                    />
                  )}
                </div>

                {/* Время — кликабельный */}
                <div
                  ref={timeBlockRef}
                  className="relative flex flex-col pr-4 mr-4 border-r border-border-subtle shrink-0 cursor-pointer rounded-xl px-3 py-1.5 -mx-1 transition-colors hover:bg-text-main/5"
                  onClick={handleTimeClick}
                >
                  <div className="flex items-baseline gap-1.5 leading-none">
                    <span className={cn("text-2xl font-medium font-mono", timeDone ? "text-emerald-400" : "text-text-main")}>
                      {timerDuration > 0 ? formatTime(timeRemaining) : formatTime(sessionSeconds)}
                    </span>
                    {timerDuration > 0 && (
                      <span className={cn("text-base", timeDone ? "text-emerald-400/70" : "text-text-main/40")}>
                        {timeDone ? t('goal_time_done') : t('goal_time_remaining')}
                      </span>
                    )}
                  </div>
                  {timeProgress !== null && timerDuration > 0 && (
                    <div className="w-full h-[2px] rounded-full bg-border-subtle mt-1.5">
                      <div
                        className={cn("h-[2px] rounded-full transition-all", timeDone ? "bg-emerald-400" : "bg-text-main")}
                        style={{ width: `${timeProgress}%` }}
                      />
                    </div>
                  )}
                  <span className="text-[11px] text-text-main/50 mt-1">
                    {timerDuration > 0
                      ? `${t('goal_time_of')} ${Math.round(timerDuration / 60)} ${t('goal_time_min')}`
                      : t('header_time_hint')}
                  </span>

                  {timePopupOpen && (
                    <GoalPopupPortal 
                      pos={timePopupPos}
                      type="time"
                      currentGoal={Math.round(timerDuration / 60)}
                      presets={[15, 25, 30, 60].map(p => ({ value: p * 60, label: `${p} ${t('goal_time_min')}` }))}
                      onSelect={(v) => setTimerDuration(v)}
                      onClear={() => setTimerDuration(0)}
                      onClose={() => setTimePopupOpen(false)}
                      title={t('goal_popup_time_title')}
                      clearLabel={t('goal_popup_clear')}
                    />
                  )}
                </div>

                {/* WPM — некликабельный */}
                <div className="flex flex-col shrink-0 px-3 py-1.5">
                  <div className="flex items-center gap-1.5 leading-none">
                    <div className={cn("w-2 h-2 rounded-full transition-colors duration-500", getWpmColor(wpm), status === 'writing' && "animate-pulse")} />
                    <span className="text-2xl font-medium text-text-main leading-none">{wpm}</span>
                  </div>
                  <span className="text-[11px] text-text-main/50 mt-1">{t('header_wpm')}</span>
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
