import React, { useState, useEffect } from 'react';
import { 
  CheckCircle2, Play, Clock, Plus, History, Pause, Square, X, Settings, Maximize, Minimize,
  FilePlus, FolderOpen, Save as SaveIcon, Save
} from 'lucide-react';
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
  totalDurationForDeadline,
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
    stickyPanel, headerVisibility, streamMode,
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
  const targetTime = useWritingStore(s => s.targetTime);
  const timerDuration = useWritingStore(s => s.timerDuration);
  const timeGoalReached = useWritingStore(s => s.timeGoalReached);
  const wordGoalReached = useWritingStore(s => s.wordGoalReached);
  const overtimeSeconds = useWritingStore(s => s.overtimeSeconds);
  
  const setWordGoal = useWritingStore(s => s.setWordGoal);
  const setTimerDuration = useWritingStore(s => s.setTimerDuration);
  const setStatus = useWritingStore(s => s.setStatus);

  const [wordGoalOpen, setWordGoalOpen] = useState(false);
  const [timeGoalOpen, setTimeGoalOpen] = useState(false);

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
          {betaLifeLog ? (
            <div className="w-full mx-auto flex flex-col gap-0 bg-surface-card backdrop-blur-2xl border border-border-subtle rounded-2xl shadow-sm overflow-hidden">
              {/* Верхний ряд — файлы и управление воспроизведением */}
              <div className="flex items-center gap-2 px-6 py-2 border-b border-border-subtle/50">
                {/* 1. НОВАЯ — сброс всего */}
                <button
                  onClick={onNew}
                  title={t('topbar_new')}
                  className="w-9 h-9 rounded-xl border border-border-subtle flex items-center justify-center text-text-main/50 hover:text-text-main transition-all"
                >
                  <FilePlus size={15} />
                </button>

                {/* 2. ОТКРЫТЬ — модалка выбора сессий */}
                <button
                  onClick={onOpenLog}
                  title={t('topbar_open')}
                  className="w-9 h-9 rounded-xl border border-border-subtle flex items-center justify-center text-text-main/50 hover:text-text-main transition-all"
                >
                  <FolderOpen size={15} />
                </button>

                {/* 3. СОХРАНИТЬ — сохранить без сброса */}
                <button
                  onClick={onSave}
                  disabled={status === 'idle' || wordCount === 0}
                  title={t('topbar_save')}
                  className={cn(
                    "w-9 h-9 rounded-xl border flex items-center justify-center transition-all",
                    status !== 'idle' && wordCount > 0
                      ? "border-border-subtle text-text-main/50 hover:text-text-main"
                      : "border-border-subtle text-text-main/20 cursor-not-allowed"
                  )}
                >
                  <Save size={15} />
                </button>

                <div className="w-px h-5 bg-border-subtle mx-1" />

                {/* 4. PLAY — активен в idle и paused */}
                <button
                  onClick={onPlay}
                  disabled={status === 'writing'}
                  title={t('beta_play')}
                  className={cn(
                    "w-9 h-9 rounded-xl border flex items-center justify-center transition-all",
                    status !== 'writing'
                      ? "border-text-main/30 text-text-main hover:bg-text-main/5"
                      : "border-border-subtle text-text-main/20 cursor-not-allowed"
                  )}
                >
                  <Play size={15} />
                </button>

                {/* 5. PAUSE — активен только в writing */}
                <button
                  onClick={onPause}
                  disabled={status !== 'writing'}
                  title={t('beta_pause')}
                  className={cn(
                    "w-9 h-9 rounded-xl border flex items-center justify-center transition-all",
                    status === 'writing'
                      ? "border-text-main/30 text-text-main hover:bg-text-main/5"
                      : "border-border-subtle text-text-main/20 cursor-not-allowed"
                  )}
                >
                  <Pause size={15} />
                </button>

                {/* 6. STOP — активен в writing и paused */}
                <button
                  onClick={onStop}
                  disabled={status === 'idle'}
                  title={t('beta_stop')}
                  className={cn(
                    "w-9 h-9 rounded-xl border flex items-center justify-center transition-all",
                    status !== 'idle'
                      ? "border-text-main/30 text-text-main hover:bg-text-main/5"
                      : "border-border-subtle text-text-main/20 cursor-not-allowed"
                  )}
                >
                  <Square size={15} />
                </button>

                {/* Название справа */}
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder={t('topbar_title_placeholder')}
                  className="ml-auto bg-transparent outline-none text-sm text-text-main/50 placeholder:text-text-main/20 text-right max-w-[240px]"
                />
              </div>

              {/* Нижний ряд — статистика */}
              <div className="flex items-center gap-4 md:gap-7 px-4 py-2.5 overflow-x-auto no-scrollbar">
                {/* Всего слов */}
                <div className="flex flex-col gap-0.5 shrink-0">
                  <span className="text-sm md:text-base font-bold text-text-main leading-none">{wordCount}</span>
                  <span className="text-[10px] md:text-[11px] text-text-main/40 whitespace-nowrap">{t('header_totalWords')}</span>
                </div>

                {/* Слов в сессии */}
                <div className="flex flex-col gap-0.5 shrink-0">
                  <span className="text-sm md:text-base font-bold text-text-main leading-none">{Math.max(0, sessionWords)}</span>
                  <span className="text-[10px] md:text-[11px] text-text-main/40 whitespace-nowrap">{t('header_sessionWords')}</span>
                </div>

                {/* Время сессии */}
                <div className="flex flex-col gap-0.5 shrink-0">
                  <span className="text-sm md:text-base font-bold text-text-main leading-none">{formatTime(sessionSeconds)}</span>
                  <span className="text-[10px] md:text-[11px] text-text-main/40 whitespace-nowrap">{t('header_sessionTime')}</span>
                </div>

                {/* WPM */}
                <div className="flex flex-col gap-0.5 shrink-0">
                  <span className="text-sm md:text-base font-bold text-text-main leading-none">{wpm}</span>
                  <span className="text-[10px] md:text-[11px] text-text-main/40 uppercase whitespace-nowrap">wpm</span>
                </div>

                {/* Кнопки + для целей */}
                <div className="ml-auto flex items-center gap-2 shrink-0">
                  {/* +Слова */}
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
                      {wordGoal ? `${wordGoal} ${t('goal_words_short')}` : t('goal_words_short')}
                    </button>

                    <AnimatePresence>
                      {wordGoalOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: -8, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -8, scale: 0.95 }}
                          className="absolute top-full mt-2 left-0 z-50 bg-surface-card border border-border-subtle rounded-2xl p-3 shadow-lg w-[180px]"
                        >
                          <div className="text-[11px] text-text-main/40 mb-2">{t('goal_popup_words_title')}</div>
                          <div className="flex gap-1 flex-wrap mb-2">
                            {[250, 500, 1000, 1500].map(p => (
                              <button
                                key={p}
                                onClick={() => { setWordGoal(p); setWordGoalOpen(false); }}
                                className={cn(
                                  "px-2 py-1 rounded-lg text-xs border transition-all",
                                  wordGoal === p
                                    ? "border-text-main bg-text-main text-surface-base"
                                    : "border-border-subtle text-text-main/60 hover:text-text-main"
                                )}
                              >{p}</button>
                            ))}
                          </div>
                          <div className="flex gap-2">
                            <input
                              type="number"
                              placeholder="500"
                              defaultValue={wordGoal || ''}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  const val = parseInt((e.target as HTMLInputElement).value);
                                  if (val > 0) { setWordGoal(val); setWordGoalOpen(false); }
                                }
                                if (e.key === 'Escape') setWordGoalOpen(false);
                              }}
                              className="flex-1 bg-surface-base border border-border-subtle rounded-xl px-2 py-1.5 text-sm text-text-main outline-none"
                              autoFocus={true}
                            />
                            {wordGoal && (
                              <button
                                onClick={() => { setWordGoal(0); setWordGoalOpen(false); }}
                                className="text-xs text-text-main/40 hover:text-text-main/70"
                              >✕</button>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* +Время — аналогично с пресетами 15/25/30/60 */}
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

                    <AnimatePresence>
                      {timeGoalOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: -8, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -8, scale: 0.95 }}
                          className="absolute top-full mt-2 left-0 z-50 bg-surface-card border border-border-subtle rounded-2xl p-3 shadow-lg w-[180px]"
                        >
                          <div className="text-[11px] text-text-main/40 mb-2">{t('goal_popup_time_title')}</div>
                          <div className="flex gap-1 flex-wrap mb-2">
                            {[15, 25, 30, 60].map(p => (
                              <button
                                key={p}
                                onClick={() => { setTimerDuration(p * 60); setTimeGoalOpen(false); }}
                                className={cn(
                                  "px-2 py-1 rounded-lg text-xs border transition-all",
                                  timerDuration === p * 60
                                    ? "border-text-main bg-text-main text-surface-base"
                                    : "border-border-subtle text-text-main/60 hover:text-text-main"
                                )}
                              >{p}м</button>
                            ))}
                          </div>
                          <div className="flex gap-2">
                            <input
                              type="number"
                              placeholder="30"
                              defaultValue={timerDuration ? Math.round(timerDuration / 60) : ''}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  const val = parseInt((e.target as HTMLInputElement).value);
                                  if (val > 0) { setTimerDuration(val * 60); setTimeGoalOpen(false); }
                                }
                                if (e.key === 'Escape') setTimeGoalOpen(false);
                              }}
                              className="flex-1 bg-surface-base border border-border-subtle rounded-xl px-2 py-1.5 text-sm text-text-main outline-none"
                              autoFocus={true}
                            />
                            {timerDuration && (
                              <button
                                onClick={() => { setTimerDuration(0); setTimeGoalOpen(false); }}
                                className="text-xs text-text-main/40 hover:text-text-main/70"
                              >✕</button>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
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
              {betaLifeLog && (
                <div className="flex items-center gap-1 mr-2 scale-90 md:scale-100 origin-left">
                  <button
                    onClick={onNew}
                    title={t('topbar_new')}
                    className="w-[28px] h-[26px] rounded-lg border border-border-subtle flex items-center justify-center text-text-main/40 hover:text-text-main hover:border-text-main/30 transition-all"
                  >
                    <FilePlus size={13} />
                  </button>
                  <button
                    onClick={onOpenLog}
                    title={t('topbar_open')}
                    className="w-[28px] h-[26px] rounded-lg border border-border-subtle flex items-center justify-center text-text-main/40 hover:text-text-main hover:border-text-main/30 transition-all"
                  >
                    <FolderOpen size={13} />
                  </button>
                  <button
                    onClick={onSave}
                    title={t('topbar_save')}
                    className="w-[28px] h-[26px] rounded-lg border border-border-subtle flex items-center justify-center text-text-main/40 hover:text-text-main hover:border-text-main/30 transition-all"
                  >
                    <SaveIcon size={13} />
                  </button>
                  <div className="w-px h-3 bg-border-subtle mx-1" />
                </div>
              )}
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
              {status === 'idle' && !betaLifeLog && (
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
                  {!betaLifeLog && (
                    <button 
                      onClick={handleFinish}
                      className="p-2.5 rounded-2xl transition-all hover:scale-105 bg-text-main text-surface-base shadow-[0_0_15px_rgba(255,255,255,0.2)]"
                      title={t('header_finish')}
                      aria-label={t('header_finish')}
                    >
                      <Square size={18} fill="currentColor" />
                    </button>
                  )}
                  {!betaLifeLog && (
                    <button 
                      onClick={() => setShowCancelConfirm(true)}
                      className="p-2.5 transition-colors rounded-2xl text-text-main/50 hover:text-red-400 hover:bg-[var(--surface-elevated)]"
                      title={t('header_cancel_session')}
                      aria-label={t('header_cancel_session')}
                    >
                      <X size={18} />
                    </button>
                  )}
                </div>
              )}
              <button
                onClick={toggleFullscreen}
                className={cn(
                  "p-2.5 rounded-2xl border transition-all bg-[var(--surface-elevated)] border-border-subtle text-text-main/50 hover:bg-text-main/10",
                  betaLifeLog && "hidden"
                )}
                title={isFullscreen ? t('header_exit_fullscreen') : t('header_fullscreen')}
              >
                {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
              </button>
              {!betaLifeLog && (
                <button
                  onClick={onOpenSettings}
                  className="p-2.5 rounded-2xl border transition-all bg-[var(--surface-elevated)] border-border-subtle text-text-main/50 hover:bg-text-main/10"
                  title={t('nav_settings')}
                  aria-label={t('nav_settings')}
                >
                  <Settings size={18} />
                </button>
              )}
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
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
});
