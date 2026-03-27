import React from 'react';
import { motion, AnimatePresence, Variants } from 'motion/react';
import { Zap, Timer, Target, PenLine, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';
import { Session } from '../../types';
import { cn } from '../../lib/utils';
import { useLanguage } from '../../lib/i18n';
import { useUI } from '../../contexts/UIContext';

export type SetupMode = 'selection' | 'timer-config' | 'words-config' | 'countdown' | 'session-selection' | 'finish-by-config' | null;

interface WritingSetupProps {
  setupMode: SetupMode;
  setSetupMode: (mode: SetupMode) => void;
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
  const { uiVersion } = useUI();
  const isV2 = uiVersion === '2.0';
  if (!setupMode) return null;

  const dateLocale = language === 'ru' ? ru : enUS;

  const containerVariants: Variants = {
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
    <>
      {setupMode === 'countdown' && (
        <div className="fixed inset-0 z-[100] bg-[#0A0A0B] flex items-center justify-center">
          <motion.div 
            key={countdown}
            initial={{ scale: 0.2, opacity: 0, rotate: -20, filter: isV2 ? 'blur(10px)' : 'none' }}
            animate={{ scale: 1, opacity: 1, rotate: 0, filter: 'blur(0px)' }}
            className={cn(
              "text-[15rem] font-black tracking-tighter z-10", 
              isV2 ? "text-white" : "text-white"
            )}
          >
            {countdown === 0 ? "GO!" : countdown}
          </motion.div>
        </div>
      )}

      <div className={cn(
        "absolute inset-0 z-50 flex items-center justify-center p-2 md:p-8 overflow-hidden",
        isV2 ? "bg-[#0A0A0B]/80 backdrop-blur-2xl" : "bg-stone-50/80 dark:bg-stone-950/80 backdrop-blur-xl"
      )}>
        {setupMode !== 'countdown' && (
          <motion.div 
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={cn(
              "w-full max-w-2xl rounded-[2rem] md:rounded-[2.5rem] flex flex-col max-h-[95vh] md:max-h-[90vh]",
              isV2 
                ? "bg-[#0A0A0B]/80 backdrop-blur-2xl border border-white/10 shadow-[0_0_40px_rgba(255,255,255,0.05)] text-[#E5E5E0]" 
                : "bg-white dark:bg-stone-900 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.1)] dark:shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] border border-stone-200/50 dark:border-stone-800/50"
            )}
          >
            <div className="p-4 md:p-10 overflow-y-auto no-scrollbar space-y-6 md:space-y-8">
              {setupMode === 'selection' && (
                <>
                  <div className="text-center space-y-2 md:space-y-3">
                    <h3 className={cn("text-2xl md:text-4xl font-black tracking-tight", isV2 ? "text-white" : "dark:text-stone-100")}>{t('writing_select_mode')}</h3>
                    <p className={cn("text-sm md:text-base font-medium", isV2 ? "text-white/50" : "text-stone-500 dark:text-stone-400")}>{t('writing_how_to_write')}</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
                    {[
                      { id: 'stopwatch', icon: Zap, label: 'writing_mode_flow', desc: 'writing_mode_flow_desc', color: isV2 ? 'text-amber-400' : 'text-amber-500', bg: isV2 ? 'bg-amber-400/10' : 'bg-amber-50 dark:bg-amber-500/10' },
                      { id: 'timer-config', icon: Timer, label: 'writing_mode_timer', desc: 'writing_mode_timer_desc', color: isV2 ? 'text-blue-400' : 'text-blue-500', bg: isV2 ? 'bg-blue-400/10' : 'bg-blue-50 dark:bg-blue-500/10' },
                      { id: 'words-config', icon: Target, label: 'writing_mode_words', desc: 'writing_mode_words_desc', color: isV2 ? 'text-rose-400' : 'text-rose-500', bg: isV2 ? 'bg-rose-400/10' : 'bg-rose-50 dark:bg-rose-500/10' },
                      { id: 'finish-by-config', icon: Clock, label: 'writing_mode_deadline', desc: 'writing_mode_deadline_desc', color: isV2 ? 'text-emerald-400' : 'text-emerald-500', bg: isV2 ? 'bg-emerald-400/10' : 'bg-emerald-50 dark:bg-emerald-500/10' }
                    ].map((mode) => (
                      <button 
                        key={mode.id}
                        onClick={() => mode.id === 'stopwatch' ? startCountdown('stopwatch') : setSetupMode(mode.id as SetupMode)}
                        className={cn(
                          "group relative flex flex-col gap-3 md:gap-4 p-4 md:p-6 border rounded-2xl md:rounded-3xl transition-all duration-300 text-left overflow-hidden",
                          isV2 ? "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20" : "bg-stone-50 dark:bg-stone-800/50 border-transparent hover:border-stone-900 dark:hover:border-stone-100"
                        )}
                      >
                        <div className={cn("w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110 duration-500", mode.bg, mode.color)}>
                          <mode.icon size={20} className="md:w-6 md:h-6" strokeWidth={2.5} />
                        </div>
                        <div>
                          <div className={cn("font-bold text-base md:text-lg group-hover:translate-x-1 transition-transform duration-300", isV2 ? "text-white" : "dark:text-stone-100")}>{t(mode.label)}</div>
                          <div className={cn("text-[10px] md:text-xs line-clamp-2", isV2 ? "text-white/50" : "text-stone-500 dark:text-stone-400")}>{t(mode.desc)}</div>
                        </div>
                      </button>
                    ))}
                  </div>

                  <div 
                    onClick={() => setIsLocalOnly(!isLocalOnly)}
                    className={cn(
                      "p-4 md:p-5 rounded-2xl md:rounded-3xl border flex items-center gap-3 md:gap-4 cursor-pointer transition-colors group",
                      isV2 ? "bg-white/5 border-white/10 hover:bg-white/10" : "bg-stone-50 dark:bg-stone-800/50 border-stone-100 dark:border-stone-800 hover:bg-stone-100 dark:hover:bg-stone-800"
                    )}
                  >
                    <div className={cn(
                      "w-10 h-5 md:w-12 md:h-6 rounded-full transition-all duration-500 relative shrink-0", 
                      isLocalOnly ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.4)]" : (isV2 ? "bg-white/20" : "bg-stone-300 dark:bg-stone-700")
                    )}>
                      <div className={cn(
                        "absolute top-0.5 left-0.5 md:top-1 md:left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-500", 
                        isLocalOnly ? "translate-x-5 md:translate-x-6" : "translate-x-0"
                      )} />
                    </div>
                    <div className="flex-1">
                      <div className={cn("font-bold text-xs md:text-sm", isV2 ? "text-white" : "dark:text-stone-100")}>{t('writing_local_session')}</div>
                      <div className={cn("text-[9px] md:text-[10px] leading-tight", isV2 ? "text-white/50" : "text-stone-500 dark:text-stone-400")}>{t('writing_local_desc')}</div>
                    </div>
                  </div>
                </>
              )}

              {(setupMode === 'timer-config' || setupMode === 'words-config' || setupMode === 'finish-by-config') && (
                <div className="space-y-6 md:space-y-10 py-2 md:py-4">
                  <div className="text-center space-y-2">
                    <h3 className={cn("text-2xl md:text-3xl font-black tracking-tight", isV2 ? "text-white" : "dark:text-stone-100")}>
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
                            className={cn("w-32 md:w-40 text-center text-5xl md:text-7xl font-black bg-transparent outline-none transition-all focus:scale-110", isV2 ? "text-white" : "text-stone-900 dark:text-stone-100")}
                            min="1"
                            autoFocus
                          />
                          <div className={cn("text-[10px] md:text-xs font-black uppercase tracking-[0.2em] mt-2", isV2 ? "text-white/50" : "text-stone-400")}>{t('writing_minutes')}</div>
                        </div>
                      )}
                      {setupMode === 'words-config' && (
                        <div className="flex flex-col items-center">
                          <input 
                            type="number" 
                            value={wordGoal}
                            onChange={(e) => setWordGoal(Number(e.target.value))}
                            className={cn("w-40 md:w-48 text-center text-5xl md:text-7xl font-black bg-transparent outline-none transition-all focus:scale-110", isV2 ? "text-white" : "text-stone-900 dark:text-stone-100")}
                            min="10"
                            step="50"
                            autoFocus
                          />
                          <div className={cn("text-[10px] md:text-xs font-black uppercase tracking-[0.2em] mt-2", isV2 ? "text-white/50" : "text-stone-400")}>{t('writing_words')}</div>
                        </div>
                      )}
                      {setupMode === 'finish-by-config' && (
                        <div className="flex flex-col items-center">
                          <input 
                            type="time" 
                            value={targetTime || ''}
                            onChange={(e) => setTargetTime(e.target.value)}
                            className={cn("w-56 md:w-64 text-center text-5xl md:text-7xl font-black bg-transparent outline-none transition-all focus:scale-110", isV2 ? "text-white" : "text-stone-900 dark:text-stone-100")}
                            autoFocus
                          />
                          <div className={cn("text-[10px] md:text-xs font-black uppercase tracking-[0.2em] mt-2", isV2 ? "text-white/50" : "text-stone-400")}>{t('writing_time')}</div>
                        </div>
                      )}
                    </div>

                    <div className="w-full flex flex-col gap-2 md:gap-3">
                      <button 
                        onClick={() => startCountdown(setupMode === 'timer-config' ? 'timer' : setupMode === 'words-config' ? 'words' : 'finish-by')}
                        className={cn(
                          "w-full py-4 md:py-5 rounded-2xl md:rounded-[1.5rem] font-black text-base md:text-lg hover:scale-[1.02] active:scale-[0.98] transition-all",
                          isV2 ? "bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.2)]" : "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 shadow-[0_20px_40px_-12px_rgba(0,0,0,0.2)] dark:shadow-[0_20px_40px_-12px_rgba(255,255,255,0.1)]"
                        )}
                      >
                        {t('writing_start')}
                      </button>
                      <button 
                        onClick={() => setSetupMode('selection')} 
                        className={cn("w-full py-2 text-xs md:text-sm font-bold transition-colors", isV2 ? "text-white/50 hover:text-white" : "text-stone-400 hover:text-stone-900 dark:hover:text-stone-100")}
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
                    <h3 className={cn("text-2xl md:text-3xl font-black tracking-tight", isV2 ? "text-white" : "dark:text-stone-100")}>{t('writing_continue_session')}</h3>
                  </div>
                  
                  <div className="grid grid-cols-1 gap-3 md:gap-4 max-h-[400px] md:max-h-[450px] overflow-y-auto pr-2 custom-scrollbar">
                    {userSessions.length === 0 ? (
                      <div className={cn("p-10 md:p-16 text-center space-y-4 rounded-2xl md:rounded-[2rem] border-2 border-dashed", isV2 ? "bg-white/5 border-white/10" : "bg-stone-50 dark:bg-stone-800/30 border-stone-200 dark:border-stone-800")}>
                        <div className={cn("w-12 h-12 md:w-16 md:h-16 rounded-full flex items-center justify-center mx-auto", isV2 ? "bg-white/10 text-white/50" : "bg-stone-100 dark:bg-stone-800 text-stone-300")}>
                          <PenLine size={24} className="md:w-8 md:h-8" />
                        </div>
                        <p className={cn("text-sm md:text-base font-medium italic", isV2 ? "text-white/50" : "text-stone-400")}>{t('writing_no_sessions')}</p>
                      </div>
                    ) : (
                      userSessions.map(session => (
                        <button 
                          key={session.id}
                          onClick={() => continueSession(session)}
                          className={cn(
                            "group flex flex-col gap-3 md:gap-4 p-4 md:p-6 border rounded-2xl md:rounded-[2rem] transition-all duration-300 text-left",
                            isV2 ? "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20" : "bg-stone-50 dark:bg-stone-800/50 border-transparent hover:border-stone-900 dark:hover:border-stone-100"
                          )}
                        >
                          <div className="flex items-center justify-between w-full">
                            <div className="flex items-center gap-3 md:gap-4">
                              <div className={cn("w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl flex items-center justify-center transition-colors shadow-sm", isV2 ? "bg-white/10 text-white/50 group-hover:text-white" : "bg-white dark:bg-stone-900 text-stone-400 group-hover:text-stone-900 dark:group-hover:text-stone-100")}>
                                <PenLine size={20} className="md:w-6 md:h-6" />
                              </div>
                              <div>
                                <div className={cn("font-black text-base md:text-lg group-hover:translate-x-1 transition-transform duration-300", isV2 ? "text-white" : "dark:text-stone-100")}>
                                  {session.title || t('common_untitled')}
                                </div>
                                <div className={cn("text-[10px] font-bold uppercase tracking-wider", isV2 ? "text-white/50" : "text-stone-400")}>
                                  {session.wordCount} {t('writing_words')} · {formatTime(session.duration)}
                                </div>
                              </div>
                            </div>
                            <div className={cn("text-[8px] md:text-[10px] font-black uppercase tracking-widest px-2 md:px-3 py-1 rounded-full", isV2 ? "bg-white/10 text-white/50" : "text-stone-400 dark:text-stone-500 bg-stone-100 dark:bg-stone-900")}>
                              {session.createdAt?.toDate ? format(session.createdAt.toDate(), 'd MMM', { locale: dateLocale }) : ''}
                            </div>
                          </div>
                          
                          {session.content && (
                            <div className={cn("text-xs md:text-sm line-clamp-2 italic font-serif leading-relaxed border-l-4 pl-3 md:pl-4 py-1", isV2 ? "text-white/50 border-white/20" : "text-stone-500 dark:text-stone-400 border-stone-200 dark:border-stone-800")}>
                              {session.content}
                            </div>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                  <button 
                    onClick={() => setSetupMode(null)} 
                    className={cn("w-full py-3 md:py-4 text-xs md:text-sm font-bold transition-colors", isV2 ? "text-white/50 hover:text-white" : "text-stone-400 hover:text-stone-900 dark:hover:text-stone-100")}
                  >
                    {t('writing_cancel')}
                  </button>
                </div>
              )}
            </div>

            {setupMode === 'selection' && (
              <div className={cn("px-10 py-6 border-t flex justify-center", isV2 ? "bg-white/5 border-white/10" : "bg-stone-50 dark:bg-stone-800/30 border-stone-100 dark:border-stone-800")}>
                <button 
                  onClick={() => setSetupMode(null)} 
                  className={cn("text-xs font-black uppercase tracking-[0.2em] transition-all hover:tracking-[0.3em]", isV2 ? "text-white/50 hover:text-white" : "text-stone-400 hover:text-stone-900 dark:hover:text-stone-100")}
                >
                  {t('writing_cancel')}
                </button>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </>

  );
}
