import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Zap, Timer, Target, PenLine, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';
import { Session } from '../../types';
import { cn } from '../../lib/utils';
import { useLanguage } from '../../lib/i18n';

interface WritingSetupProps {
  setupMode: 'selection' | 'timer-config' | 'words-config' | 'countdown' | 'session-selection' | 'finish-by-config' | null;
  setSetupMode: (mode: any) => void;
  startCountdown: (type: 'stopwatch' | 'timer' | 'words' | 'finish-by') => void;
  timerDuration: number;
  setTimerDuration: (duration: number) => void;
  wordGoal: number;
  setWordGoal: (goal: number) => void;
  targetTime: string | null;
  setTargetTime: (time: string | null) => void;
  countdown: number | null;
  userSessions: Session[];
  continueSession: (session: Session) => void;
  formatTime: (s: number) => string;
  isLocalOnly: boolean;
  setIsLocalOnly: (enabled: boolean) => void;
}

export function WritingSetup({
  setupMode,
  setSetupMode,
  startCountdown,
  timerDuration,
  setTimerDuration,
  wordGoal,
  setWordGoal,
  targetTime,
  setTargetTime,
  countdown,
  userSessions,
  continueSession,
  formatTime,
  isLocalOnly,
  setIsLocalOnly
}: WritingSetupProps) {
  const { t, language } = useLanguage();
  if (!setupMode) return null;

  const dateLocale = language === 'ru' ? ru : enUS;

  const containerVariants: any = {
    hidden: { opacity: 0, scale: 0.95 },
    visible: { 
      opacity: 1, 
      scale: 1,
      transition: { 
        type: 'spring',
        damping: 25,
        stiffness: 300
      }
    },
    exit: { opacity: 0, scale: 0.95 }
  };

  return (
    <div className="absolute inset-0 z-50 bg-stone-50/80 dark:bg-stone-950/80 backdrop-blur-xl rounded-[2rem] flex items-center justify-center p-2 md:p-8 overflow-hidden">
      <motion.div 
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="w-full max-w-2xl bg-white dark:bg-stone-900 rounded-[2rem] md:rounded-[2.5rem] shadow-[0_32px_64px_-16px_rgba(0,0,0,0.1)] dark:shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] border border-stone-200/50 dark:border-stone-800/50 flex flex-col max-h-[95vh] md:max-h-[90vh]"
      >
        <div className="p-4 md:p-10 overflow-y-auto no-scrollbar space-y-6 md:space-y-8">
          {setupMode === 'selection' && (
            <>
              <div className="text-center space-y-2 md:space-y-3">
                <h3 className="text-2xl md:text-4xl font-black tracking-tight dark:text-stone-100">{t('writing_select_mode')}</h3>
                <p className="text-sm md:text-base text-stone-500 dark:text-stone-400 font-medium">{t('writing_how_to_write')}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
                {[
                  { id: 'stopwatch', icon: Zap, label: 'writing_mode_flow', desc: 'writing_mode_flow_desc', color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-500/10' },
                  { id: 'timer-config', icon: Timer, label: 'writing_mode_timer', desc: 'writing_mode_timer_desc', color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-500/10' },
                  { id: 'words-config', icon: Target, label: 'writing_mode_words', desc: 'writing_mode_words_desc', color: 'text-rose-500', bg: 'bg-rose-50 dark:bg-rose-500/10' },
                  { id: 'finish-by-config', icon: Clock, label: 'writing_mode_deadline', desc: 'writing_mode_deadline_desc', color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10' }
                ].map((mode) => (
                  <button 
                    key={mode.id}
                    onClick={() => mode.id === 'stopwatch' ? startCountdown('stopwatch') : setSetupMode(mode.id as any)}
                    className="group relative flex flex-col gap-3 md:gap-4 p-4 md:p-6 bg-stone-50 dark:bg-stone-800/50 border border-transparent hover:border-stone-900 dark:hover:border-stone-100 rounded-2xl md:rounded-3xl transition-all duration-300 text-left overflow-hidden"
                  >
                    <div className={cn("w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110 duration-500", mode.bg, mode.color)}>
                      <mode.icon size={20} className="md:w-6 md:h-6" strokeWidth={2.5} />
                    </div>
                    <div>
                      <div className="font-bold text-base md:text-lg dark:text-stone-100 group-hover:translate-x-1 transition-transform duration-300">{t(mode.label)}</div>
                      <div className="text-[10px] md:text-xs text-stone-500 dark:text-stone-400 line-clamp-2">{t(mode.desc)}</div>
                    </div>
                  </button>
                ))}
              </div>

              <div 
                onClick={() => setIsLocalOnly(!isLocalOnly)}
                className="p-4 md:p-5 bg-stone-50 dark:bg-stone-800/50 rounded-2xl md:rounded-3xl border border-stone-100 dark:border-stone-800 flex items-center gap-3 md:gap-4 cursor-pointer hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors group"
              >
                <div className={cn(
                  "w-10 h-5 md:w-12 md:h-6 rounded-full transition-all duration-500 relative shrink-0", 
                  isLocalOnly ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.4)]" : "bg-stone-300 dark:bg-stone-700"
                )}>
                  <div className={cn(
                    "absolute top-0.5 left-0.5 md:top-1 md:left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-500", 
                    isLocalOnly ? "translate-x-5 md:translate-x-6" : "translate-x-0"
                  )} />
                </div>
                <div className="flex-1">
                  <div className="font-bold text-xs md:text-sm dark:text-stone-100">{t('writing_local_session')}</div>
                  <div className="text-[9px] md:text-[10px] text-stone-500 dark:text-stone-400 leading-tight">{t('writing_local_desc')}</div>
                </div>
              </div>
            </>
          )}

          {(setupMode === 'timer-config' || setupMode === 'words-config' || setupMode === 'finish-by-config') && (
            <div className="space-y-6 md:space-y-10 py-2 md:py-4">
              <div className="text-center space-y-2">
                <h3 className="text-2xl md:text-3xl font-black tracking-tight dark:text-stone-100">
                  {setupMode === 'timer-config' ? t('writing_set_timer') : 
                   setupMode === 'words-config' ? t('writing_mode_words') : t('writing_mode_deadline')}
                </h3>
              </div>

              <div className="flex flex-col items-center gap-6 md:gap-8">
                <div className="relative group">
                  {setupMode === 'timer-config' && (
                    <div className="flex flex-col items-center">
                      <input 
                        type="number" 
                        value={timerDuration / 60}
                        onChange={(e) => setTimerDuration(Number(e.target.value) * 60)}
                        className="w-32 md:w-40 text-center text-5xl md:text-7xl font-black bg-transparent text-stone-900 dark:text-stone-100 outline-none transition-all focus:scale-110"
                        min="1"
                        autoFocus
                      />
                      <div className="text-stone-400 text-[10px] md:text-xs font-black uppercase tracking-[0.2em] mt-2">{t('writing_minutes')}</div>
                    </div>
                  )}
                  {setupMode === 'words-config' && (
                    <div className="flex flex-col items-center">
                      <input 
                        type="number" 
                        value={wordGoal}
                        onChange={(e) => setWordGoal(Number(e.target.value))}
                        className="w-40 md:w-48 text-center text-5xl md:text-7xl font-black bg-transparent text-stone-900 dark:text-stone-100 outline-none transition-all focus:scale-110"
                        min="10"
                        step="50"
                        autoFocus
                      />
                      <div className="text-stone-400 text-[10px] md:text-xs font-black uppercase tracking-[0.2em] mt-2">{t('writing_words')}</div>
                    </div>
                  )}
                  {setupMode === 'finish-by-config' && (
                    <div className="flex flex-col items-center">
                      <input 
                        type="time" 
                        value={targetTime || ''}
                        onChange={(e) => setTargetTime(e.target.value)}
                        className="w-56 md:w-64 text-center text-5xl md:text-7xl font-black bg-transparent text-stone-900 dark:text-stone-100 outline-none transition-all focus:scale-110"
                        autoFocus
                      />
                      <div className="text-stone-400 text-[10px] md:text-xs font-black uppercase tracking-[0.2em] mt-2">{t('writing_time')}</div>
                    </div>
                  )}
                </div>

                <div className="w-full flex flex-col gap-2 md:gap-3">
                  <button 
                    onClick={() => startCountdown(setupMode === 'timer-config' ? 'timer' : setupMode === 'words-config' ? 'words' : 'finish-by')}
                    className="w-full bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 py-4 md:py-5 rounded-2xl md:rounded-[1.5rem] font-black text-base md:text-lg shadow-[0_20px_40px_-12px_rgba(0,0,0,0.2)] dark:shadow-[0_20px_40px_-12px_rgba(255,255,255,0.1)] hover:scale-[1.02] active:scale-[0.98] transition-all"
                  >
                    {t('writing_start')}
                  </button>
                  <button 
                    onClick={() => setSetupMode('selection')} 
                    className="w-full py-2 text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 text-xs md:text-sm font-bold transition-colors"
                  >
                    {t('writing_back')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {setupMode === 'session-selection' && (
            <div className="space-y-6 md:space-y-8">
              <div className="text-center space-y-2">
                <h3 className="text-2xl md:text-3xl font-black tracking-tight dark:text-stone-100">{t('writing_continue_session')}</h3>
              </div>
              
              <div className="grid grid-cols-1 gap-3 md:gap-4 max-h-[400px] md:max-h-[450px] overflow-y-auto pr-2 custom-scrollbar">
                {userSessions.length === 0 ? (
                  <div className="p-10 md:p-16 text-center space-y-4 bg-stone-50 dark:bg-stone-800/30 rounded-2xl md:rounded-[2rem] border-2 border-dashed border-stone-200 dark:border-stone-800">
                    <div className="w-12 h-12 md:w-16 md:h-16 bg-stone-100 dark:bg-stone-800 rounded-full flex items-center justify-center mx-auto text-stone-300">
                      <PenLine size={24} className="md:w-8 md:h-8" />
                    </div>
                    <p className="text-sm md:text-base text-stone-400 font-medium italic">{t('writing_no_sessions')}</p>
                  </div>
                ) : (
                  userSessions.map(session => (
                    <button 
                      key={session.id}
                      onClick={() => continueSession(session)}
                      className="group flex flex-col gap-3 md:gap-4 p-4 md:p-6 bg-stone-50 dark:bg-stone-800/50 border border-transparent hover:border-stone-900 dark:hover:border-stone-100 rounded-2xl md:rounded-[2rem] transition-all duration-300 text-left"
                    >
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-3 md:gap-4">
                          <div className="w-10 h-10 md:w-12 md:h-12 bg-white dark:bg-stone-900 rounded-xl md:rounded-2xl flex items-center justify-center text-stone-400 group-hover:text-stone-900 dark:group-hover:text-stone-100 transition-colors shadow-sm">
                            <PenLine size={20} className="md:w-6 md:h-6" />
                          </div>
                          <div>
                            <div className="font-black text-base md:text-lg dark:text-stone-100 group-hover:translate-x-1 transition-transform duration-300">
                              {session.title || t('common_untitled')}
                            </div>
                            <div className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">
                              {session.wordCount} {t('writing_words')} · {formatTime(session.duration)}
                            </div>
                          </div>
                        </div>
                        <div className="text-[8px] md:text-[10px] font-black text-stone-400 dark:text-stone-500 uppercase tracking-widest bg-stone-100 dark:bg-stone-900 px-2 md:px-3 py-1 rounded-full">
                          {session.createdAt?.toDate ? format(session.createdAt.toDate(), 'd MMM', { locale: dateLocale }) : ''}
                        </div>
                      </div>
                      
                      {session.content && (
                        <div className="text-xs md:text-sm text-stone-500 dark:text-stone-400 line-clamp-2 italic font-serif leading-relaxed border-l-4 border-stone-200 dark:border-stone-800 pl-3 md:pl-4 py-1">
                          {session.content}
                        </div>
                      )}
                    </button>
                  ))
                )}
              </div>
              <button 
                onClick={() => setSetupMode(null)} 
                className="w-full py-3 md:py-4 text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 text-xs md:text-sm font-bold transition-colors"
              >
                {t('writing_cancel')}
              </button>
            </div>
          )}

          {setupMode === 'countdown' && (
            <div className="absolute inset-0 z-[100] bg-stone-900 dark:bg-stone-100 rounded-[2.5rem] flex items-center justify-center overflow-hidden">
              <motion.div 
                key={countdown}
                initial={{ scale: 0.2, opacity: 0, rotate: -20 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                className="text-white dark:text-stone-900 text-[12rem] font-black italic tracking-tighter"
              >
                {countdown === 0 ? "GO!" : countdown}
              </motion.div>
              
              {/* Decorative elements */}
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-1/4 left-1/4 w-32 h-32 border-4 border-white/10 dark:border-stone-900/10 rounded-full animate-ping" />
                <div className="absolute bottom-1/4 right-1/4 w-48 h-48 border-4 border-white/10 dark:border-stone-900/10 rounded-full animate-pulse" />
              </div>
            </div>
          )}
        </div>

        {setupMode === 'selection' && (
          <div className="px-10 py-6 bg-stone-50 dark:bg-stone-800/30 border-t border-stone-100 dark:border-stone-800 flex justify-center">
            <button 
              onClick={() => setSetupMode(null)} 
              className="text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 text-xs font-black uppercase tracking-[0.2em] transition-all hover:tracking-[0.3em]"
            >
              {t('writing_cancel')}
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
