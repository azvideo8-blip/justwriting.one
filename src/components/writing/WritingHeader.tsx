import React, { useState, useEffect } from 'react';
import { CheckCircle2, Play, Clock, Settings, Plus, History, Pause, Square, X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface WritingHeaderProps {
  status: 'idle' | 'writing' | 'paused' | 'finished';
  sessionType: 'stopwatch' | 'timer' | 'words';
  timeGoalReached: boolean;
  wordGoalReached: boolean;
  seconds: number;
  wordCount: number;
  initialWordCount: number;
  wordGoal: number;
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

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hours = currentTime.getHours().toString().padStart(2, '0');
  const minutes = currentTime.getMinutes().toString().padStart(2, '0');

  return (
    <div className={cn(
      "w-full bg-white dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800 z-40 shadow-sm transition-all duration-1000",
      stickyHeaderEnabled && "sticky top-16",
      isZenActive ? "opacity-0 pointer-events-none -translate-y-4" : "opacity-100 translate-y-0"
    )}>
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-4 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-6 overflow-x-auto no-scrollbar">
          {headerVisibility.currentTime && (
            <>
              <div className="flex flex-col relative shrink-0">
                <span className="text-[10px] font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest mb-1">Текущее время</span>
                <span className="text-2xl font-mono font-bold dark:text-stone-100 flex items-center">
                  {hours}
                  <span className="animate-pulse">:</span>
                  {minutes}
                </span>
              </div>
              <div className="h-10 w-px bg-stone-100 dark:bg-stone-800" />
            </>
          )}
          
          {headerVisibility.sessionTime && (
            <>
              <div className="flex flex-col relative shrink-0">
                <span className="text-[10px] font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest mb-1 flex items-center gap-1">
                  Время {sessionType === 'timer' && timeGoalReached && <CheckCircle2 size={10} className="text-emerald-500" />}
                </span>
                <span className={cn(
                  "text-2xl font-mono font-bold transition-colors",
                  sessionType === 'timer' && timeGoalReached ? "text-emerald-500" : "dark:text-stone-100"
                )}>
                  {formatTime(seconds)}
                </span>
              </div>
              <div className="h-10 w-px bg-stone-100 dark:bg-stone-800" />
            </>
          )}

          {headerVisibility.sessionWords && (
            <>
              <div className="flex flex-col relative">
                <span className="text-[10px] font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest mb-1 flex items-center gap-1">
                  Написано слов {sessionType === 'words' && wordGoalReached && <CheckCircle2 size={10} className="text-emerald-500" />}
                </span>
                <span className={cn(
                  "text-2xl font-mono font-bold transition-colors",
                  sessionType === 'words' && wordGoalReached ? "text-emerald-500" : "dark:text-stone-100"
                )}>
                  {Math.max(0, wordCount - initialWordCount)}
                  {sessionType === 'words' && <span className="text-sm text-stone-400 ml-1">/ {wordGoal}</span>}
                </span>
              </div>
              <div className="h-10 w-px bg-stone-100 dark:bg-stone-800" />
            </>
          )}

          {headerVisibility.totalWords && (
            <>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest mb-1">Всего слов</span>
                <span className="text-2xl font-mono font-bold dark:text-stone-100">{wordCount}</span>
              </div>
              <div className="h-10 w-px bg-stone-100 dark:bg-stone-800" />
            </>
          )}

          {headerVisibility.wpm && (
            <div className="flex flex-col">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest">WPM</span>
                {status === 'writing' && (
                  <div className={cn(
                    "w-2 h-2 rounded-full animate-pulse transition-colors duration-500",
                    wpm === 0 ? "bg-stone-300" :
                    wpm < 10 ? "bg-amber-400" :
                    wpm < 20 ? "bg-lime-400" : "bg-emerald-500"
                  )} />
                )}
              </div>
              <span className="text-2xl font-mono font-bold dark:text-stone-100">{wpm}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {status === 'idle' && (
            <div className="flex gap-2">
              <button 
                onClick={handleNewSession}
                className="p-3 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 shadow-lg hover:scale-105 transition-all"
                title="Новая сессия"
              >
                <Plus size={20} />
              </button>
              <button 
                onClick={fetchUserSessions}
                disabled={loadingSessions}
                className="p-3 rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-stone-900 dark:text-stone-100 hover:bg-stone-50 dark:hover:bg-stone-800 transition-all disabled:opacity-50"
                title="Продолжить"
              >
                <Clock size={20} />
              </button>
              {hasDraft && (
                <button 
                  onClick={() => setStatus('writing')}
                  className="p-3 rounded-xl bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700 transition-all"
                  title="Черновик"
                >
                  <History size={20} />
                </button>
              )}
            </div>
          )}
          {(status === 'writing' || status === 'paused') && (
            <div className="flex items-center gap-3">
              {status === 'writing' && (
                <button 
                  onClick={handlePause}
                  className="p-3 rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800 transition-all"
                  title="Пауза"
                >
                  <Pause size={20} fill="currentColor" />
                </button>
              )}
              {status === 'paused' && (
                <button 
                  onClick={handleStart}
                  className="p-3 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:scale-105 transition-all"
                  title="Продолжить"
                >
                  <Play size={20} fill="currentColor" />
                </button>
              )}
              <button 
                onClick={handleFinish}
                className="p-3 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:scale-105 transition-all"
                title="Завершить"
              >
                <Square size={20} fill="currentColor" />
              </button>
              <button 
                onClick={() => setShowCancelConfirm(true)}
                className="p-3 text-stone-400 hover:text-red-500 transition-colors"
                title="Отменить сессию"
              >
                <X size={20} />
              </button>
            </div>
          )}
          <button 
            onClick={() => setShowSettings(true)}
            className="p-3 rounded-xl bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700 transition-all"
            title="Настройки"
          >
            <Settings size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
