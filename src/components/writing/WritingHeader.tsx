import React from 'react';
import { CheckCircle2, Play, Clock, Settings } from 'lucide-react';
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
  isZenActive?: boolean;
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
  isZenActive = false
}: WritingHeaderProps) {
  return (
    <div className={cn(
      "w-full bg-white dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800 sticky top-0 z-40 shadow-sm transition-all duration-1000",
      isZenActive ? "opacity-0 pointer-events-none -translate-y-4" : "opacity-100 translate-y-0"
    )}>
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-4 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-6 overflow-x-auto no-scrollbar">
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
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest mb-1">Всего слов</span>
            <span className="text-2xl font-mono font-bold dark:text-stone-100">{wordCount}</span>
          </div>
          <div className="h-10 w-px bg-stone-100 dark:bg-stone-800" />
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest mb-1">WPM</span>
            <span className="text-2xl font-mono font-bold dark:text-stone-100">{wpm}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {status === 'idle' && (
            <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
              <button 
                onClick={handleNewSession}
                className="flex items-center justify-center gap-2 bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 px-8 py-4 rounded-2xl font-bold shadow-xl shadow-stone-200 dark:shadow-none hover:scale-105 transition-all"
              >
                <Play size={20} fill="currentColor" />
                Новая
              </button>
              <button 
                onClick={fetchUserSessions}
                disabled={loadingSessions}
                className="flex items-center justify-center gap-2 bg-white dark:bg-stone-900 border-2 border-stone-900 dark:border-stone-100 text-stone-900 dark:text-stone-100 px-8 py-4 rounded-2xl font-bold hover:bg-stone-50 dark:hover:bg-stone-800 transition-all disabled:opacity-50"
              >
                <Clock size={20} />
                {loadingSessions ? 'Загрузка...' : 'Продолжить'}
              </button>
              {hasDraft && (
                <button 
                  onClick={() => setStatus('writing')}
                  className="flex items-center justify-center gap-2 bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 px-6 py-4 rounded-2xl font-bold hover:bg-stone-200 dark:hover:bg-stone-700 transition-all"
                >
                  Черновик
                </button>
              )}
            </div>
          )}
          <button 
            onClick={() => setShowSettings(true)}
            className="flex items-center justify-center gap-2 bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 px-6 py-4 rounded-2xl font-bold hover:bg-stone-200 dark:hover:bg-stone-700 transition-all"
            title="Настройки текста"
          >
            <Settings size={20} />
            <span className="hidden md:inline">Настройки</span>
          </button>
        </div>
      </div>
    </div>
  );
}
