import React from 'react';
import { motion, Variants } from 'motion/react';
import { Zap, Timer, Target, PenLine, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';
import { Session } from '../../types';
import { cn } from '../../core/utils/utils';
import { useLanguage } from '../../core/i18n';
import { formatTime } from '../../core/utils/formatTime';
import { Toggle } from '../../shared/components/Toggle';

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
  isLocalOnly: boolean;
  setIsLocalOnly: (enabled: boolean) => void;
  encryptionPassword: string;
  setEncryptionPassword: (password: string) => void;
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
  isLocalOnly,
  setIsLocalOnly,
  encryptionPassword,
  setEncryptionPassword
}: WritingSetupProps) {
  const { t, language } = useLanguage();
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
        <div className="fixed inset-0 z-[100] bg-surface-base flex items-center justify-center">
          <motion.div 
            key={countdown}
            initial={{ scale: 0.2, opacity: 0, rotate: -20, filter: 'blur(10px)' }}
            animate={{ scale: 1, opacity: 1, rotate: 0, filter: 'blur(0px)' }}
            className="text-[15rem] font-black tracking-tighter z-10 text-text-main"
          >
            {countdown === 0 ? t('writing_go') : countdown}
          </motion.div>
        </div>
      )}

      <div className="relative z-50 flex items-start justify-center p-2 md:p-8 overflow-hidden bg-surface-base/80 backdrop-blur-2xl">
        {setupMode !== 'countdown' && (
          <motion.div 
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="w-full max-w-2xl rounded-3xl md:rounded-3xl flex flex-col bg-surface-card backdrop-blur-2xl border border-border-subtle shadow-[0_0_40px_rgba(255,255,255,0.05)] text-text-main"
          >
            <div className="p-4 md:p-10 overflow-y-auto no-scrollbar space-y-4 pt-4">
              {setupMode === 'selection' && (
                <>
                  <div className="text-center space-y-2 md:space-y-3">
                    <h3 className="text-base font-bold text-text-main/70 uppercase tracking-widest">{t('writing_select_mode')}</h3>
                    <p className="text-sm md:text-base font-medium text-text-main/50">{t('writing_how_to_write')}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'stopwatch', icon: Zap, label: 'writing_mode_flow', desc: 'writing_mode_flow_desc', color: 'text-amber-400', bg: 'bg-amber-400/10' },
                      { id: 'timer-config', icon: Timer, label: 'writing_mode_timer', desc: 'writing_mode_timer_desc', color: 'text-blue-400', bg: 'bg-blue-400/10' },
                      { id: 'words-config', icon: Target, label: 'writing_mode_words', desc: 'writing_mode_words_desc', color: 'text-rose-400', bg: 'bg-rose-400/10' },
                      { id: 'finish-by-config', icon: Clock, label: 'writing_mode_deadline', desc: 'writing_mode_deadline_desc', color: 'text-emerald-400', bg: 'bg-emerald-400/10' }
                    ].map((mode) => (
                      <button 
                        key={mode.id}
                        onClick={() => mode.id === 'stopwatch' ? startCountdown('stopwatch') : setSetupMode(mode.id as SetupMode)}
                        className="px-4 py-3 rounded-2xl border border-border-subtle hover:border-text-main/40 hover:bg-text-main/5 transition-all flex items-center gap-3 text-left w-full"
                      >
                        <span className={cn("text-xl shrink-0", mode.color)}>
                          <mode.icon size={20} className="md:w-6 md:h-6" strokeWidth={2.5} />
                        </span>
                        <div className="min-w-0">
                          <div className="font-semibold text-sm text-text-main leading-tight">
                            {t(mode.label)}
                          </div>
                          <div className="text-xs text-text-main/40 leading-tight mt-0.5 hidden sm:block">
                            {t(mode.desc)}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="p-4 md:p-5 rounded-2xl md:rounded-3xl border flex items-center gap-3 md:gap-4 transition-colors group bg-white/5 border-border-subtle hover:bg-white/10">
                    <Toggle checked={isLocalOnly} onChange={setIsLocalOnly} />
                    <div className="flex-1">
                      <div className="font-bold text-xs md:text-sm text-text-main">{t('writing_local_session')}</div>
                      <div className="text-[11px] leading-tight text-text-main/50">{t('writing_local_desc')}</div>
                    </div>
                  </div>

                  {isLocalOnly && (
                    <motion.div 
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="space-y-2"
                    >
                      <div className="text-[11px] font-black uppercase tracking-widest ml-1 text-text-main/40">
                        {t('writing_encryption_password')}
                      </div>
                      <input 
                        type="password"
                        value={encryptionPassword}
                        onChange={(e) => setEncryptionPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full p-4 rounded-2xl border transition-all outline-none text-sm font-mono bg-white/5 border-border-subtle text-text-main focus:bg-white/10 focus:border-white/20"
                      />
                      <p className="text-[11px] leading-tight ml-1 text-text-main/40">
                        {t('writing_encryption_desc')}
                      </p>
                    </motion.div>
                  )}
                </>
              )}

              {(setupMode === 'timer-config' || setupMode === 'words-config' || setupMode === 'finish-by-config') && (
                <div className="space-y-6 md:space-y-10 py-2 md:py-4">
                  <div className="text-center space-y-2">
                    <h3 className="text-2xl md:text-3xl font-black tracking-tight text-text-main">
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
                            className="w-32 md:w-40 text-center text-5xl md:text-7xl font-black bg-transparent outline-none transition-all focus:scale-110 text-text-main"
                            min="1"
                            autoFocus
                          />
                          <div className="text-[11px] md:text-xs font-black uppercase tracking-[0.2em] mt-2 text-text-main/50">{t('writing_minutes')}</div>
                        </div>
                      )}
                      {setupMode === 'words-config' && (
                        <div className="flex flex-col items-center">
                          <input 
                            type="number" 
                            value={wordGoal}
                            onChange={(e) => setWordGoal(Number(e.target.value))}
                            className="w-40 md:w-48 text-center text-5xl md:text-7xl font-black bg-transparent outline-none transition-all focus:scale-110 text-text-main"
                            min="10"
                            step="50"
                            autoFocus
                          />
                          <div className="text-[11px] md:text-xs font-black uppercase tracking-[0.2em] mt-2 text-text-main/50">{t('writing_words')}</div>
                        </div>
                      )}
                      {setupMode === 'finish-by-config' && (
                        <div className="flex flex-col items-center">
                          <input 
                            type="time" 
                            value={targetTime || ''}
                            onChange={(e) => setTargetTime(e.target.value)}
                            className="w-56 md:w-64 text-center text-5xl md:text-7xl font-black bg-transparent outline-none transition-all focus:scale-110 text-text-main"
                            autoFocus
                          />
                          <div className="text-[11px] md:text-xs font-black uppercase tracking-[0.2em] mt-2 text-text-main/50">{t('writing_time')}</div>
                        </div>
                      )}
                    </div>

                    <div className="w-full flex flex-col gap-2 md:gap-3">
                      <button 
                        onClick={() => startCountdown(setupMode === 'timer-config' ? 'timer' : setupMode === 'words-config' ? 'words' : 'finish-by')}
                        className="w-full py-4 md:py-5 rounded-2xl md:rounded-[1.5rem] font-black text-base md:text-lg hover:scale-[1.02] active:scale-[0.98] transition-all bg-text-main text-surface-base shadow-[0_0_20px_rgba(255,255,255,0.2)]"
                      >
                        {t('writing_start')}
                      </button>
                      <button 
                        onClick={() => setSetupMode('selection')} 
                        className="w-full py-2 text-xs md:text-sm font-bold transition-colors text-text-main/50 hover:text-text-main"
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
                    <h3 className="text-2xl md:text-3xl font-black tracking-tight text-text-main">{t('writing_continue_session')}</h3>
                  </div>
                  
                  <div className="grid grid-cols-1 gap-3 md:gap-4 max-h-[400px] md:max-h-[450px] overflow-y-auto pr-2 custom-scrollbar">
                    {userSessions.length === 0 ? (
                      <div className="p-10 md:p-16 text-center space-y-4 rounded-2xl md:rounded-[2rem] border-2 border-dashed bg-white/5 border-border-subtle">
                        <div className="w-12 h-12 md:w-16 md:h-16 rounded-full flex items-center justify-center mx-auto bg-white/10 text-text-main/50">
                          <PenLine size={24} className="md:w-8 md:h-8" />
                        </div>
                        <p className="text-sm md:text-base font-medium italic text-text-main/50">{t('writing_no_sessions')}</p>
                      </div>
                    ) : (
                      userSessions.map(session => (
                        <button 
                          key={session.id}
                          onClick={() => continueSession(session)}
                          className="group flex flex-col gap-2 p-3 md:p-4 border rounded-2xl transition-all duration-300 text-left bg-white/5 border-border-subtle hover:bg-white/10 hover:border-white/20"
                        >
                          <div className="flex items-center justify-between w-full">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors shadow-sm bg-white/10 text-text-main/50 group-hover:text-text-main">
                                <PenLine size={16} />
                              </div>
                              <div>
                                <div className="font-bold text-sm md:text-base group-hover:translate-x-1 transition-transform duration-300 text-text-main">
                                  {session.title || t('common_untitled')}
                                </div>
                                <div className="text-[11px] font-bold uppercase tracking-wider text-text-main/50">
                                  {session.wordCount} {t('writing_words')} · {formatTime(session.duration)}
                                </div>
                              </div>
                            </div>
                            <div className="text-[11px] font-black uppercase tracking-widest px-2 py-1 rounded-full bg-white/10 text-text-main/50">
                              {session.createdAt ? format(session.createdAt instanceof Date ? session.createdAt : (session.createdAt as { toDate?: () => Date }).toDate?.() || new Date(), 'd MMM', { locale: dateLocale }) : ''}
                            </div>
                          </div>
                          
                          {session.content && (
                            <div className="text-xs line-clamp-1 italic font-serif leading-relaxed border-l-2 pl-2 py-0.5 text-text-main/50 border-border-subtle">
                              {session.content}
                            </div>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                  <button 
                    onClick={() => setSetupMode(null)} 
                    className="w-full py-3 md:py-4 text-xs md:text-sm font-bold transition-colors text-text-main/50 hover:text-text-main"
                  >
                    {t('writing_cancel')}
                  </button>
                </div>
              )}
            </div>

            {setupMode === 'selection' && (
              <div className="px-10 py-6 border-t flex justify-center bg-white/5 border-border-subtle">
                <button 
                  onClick={() => setSetupMode(null)} 
                  className="text-xs font-black uppercase tracking-[0.2em] transition-all hover:tracking-[0.3em] text-text-main/50 hover:text-text-main"
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
