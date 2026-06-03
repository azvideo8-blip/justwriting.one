import React from 'react';
import { motion, Variants } from 'motion/react';
import { Zap, Timer, Target, PenLine, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { LifeLogDocument } from '../types/lifeLog';
import { cn } from '../../../core/utils/utils';
import { getDateLocale } from '../../../core/utils/dateUtils';
import { useLanguage } from '../../../shared/i18n';
import { formatTime } from '../../../core/utils/formatTime';
import { useTimerStore } from '../store/useTimerStore';
import { Button } from '../../../shared/components/Button';

const PROMPT_KEYS = [
  { key: 'morning', promptKeys: ['prompt_morning_1', 'prompt_morning_2', 'prompt_morning_3'] },
  { key: 'reflect', promptKeys: ['prompt_reflect_1', 'prompt_reflect_2', 'prompt_reflect_3'] },
  { key: 'creative', promptKeys: ['prompt_creative_1', 'prompt_creative_2', 'prompt_creative_3'] },
] as const;

function _PromptsScreen({ t, onSelect, onBack }: {
  t: (key: string) => string;
  onSelect: (prompt: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-6 py-2 md:py-4">
      <div className="text-center space-y-2">
        <h3 className="text-2xl md:text-3xl font-black tracking-tight text-text-main">
          {t('writing_mode_prompts')}
        </h3>
      </div>

      <div className="space-y-5">
        {PROMPT_KEYS.map(cat => (
          <div key={cat.key}>
            <div className="text-label-sm font-bold uppercase tracking-widest text-text-main/40 mb-2">
              {t(`prompts_category_${cat.key}`)}
            </div>
            <div className="space-y-2">
              {cat.promptKeys.map((promptKey, i) => (
                <Button
                  key={i}
                  variant="ghost"
                  size="md"
                  onClick={() => onSelect(t(promptKey))}
                  className="w-full text-left px-4 py-3 rounded-xl border border-border-subtle hover:border-brand-primary/30 hover:bg-brand-primary/5 text-sm text-text-main/70 hover:text-text-main"
                >
                  {t(promptKey)}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Button
        variant="ghost"
        size="md"
        onClick={onBack}
        className="w-full py-2 text-xs md:text-sm font-bold text-text-main/50 hover:text-text-main"
      >
        {t('writing_back')}
      </Button>
    </div>
  );
}

export type SetupMode = 'selection' | 'timer-config' | 'words-config' | 'countdown' | 'session-selection' | 'finish-by-config' | null;

interface WritingSetupProps {
  setupMode: SetupMode;
  setSetupMode: (mode: SetupMode) => void;
  startCountdown: (type: 'stopwatch' | 'timer' | 'words' | 'finish-by') => void;
  countdown: number | null;
  userSessions: LifeLogDocument[];
  continueSession: (session: LifeLogDocument) => void;
  onSetPromptTitle?: (title: string) => void;
}

export function WritingSetup({
  setupMode,
  setSetupMode,
  startCountdown,
  countdown,
  userSessions,
  continueSession,
  onSetPromptTitle: _onSetPromptTitle,
}: WritingSetupProps) {
  const { t, language } = useLanguage();
  const timerDuration = useTimerStore(s => s.timerDuration);
  const setTimerDuration = useTimerStore(s => s.setTimerDuration);
  const wordGoal = useTimerStore(s => s.wordGoal);
  const setWordGoal = useTimerStore(s => s.setWordGoal);
  const targetTime = useTimerStore(s => s.targetTime);
  const setTargetTime = useTimerStore(s => s.setTargetTime);
  const [finishByError, setFinishByError] = React.useState(false);
  if (!setupMode) return null;

  const dateLocale = getDateLocale(language);

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
        <div className="fixed inset-0 z-[var(--z-sheet)] bg-surface-base flex items-center justify-center">
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
                      { id: 'finish-by-config', icon: Clock, label: 'writing_mode_deadline', desc: 'writing_mode_deadline_desc', color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
                    ].map((mode) => (
                      <motion.button
                        type="button"
                        key={mode.id}
                        onClick={() => mode.id === 'stopwatch' ? startCountdown('stopwatch') : setSetupMode(mode.id as SetupMode)}
                        whileHover={{ y: -2, scale: 1.01 }}
                        whileTap={{ scale: 0.98 }}
                        transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                        className="px-4 py-3 rounded-2xl border border-border-subtle hover:border-text-main/40 hover:bg-text-main/5 transition-colors flex items-center gap-3 text-left w-full"
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
                      </motion.button>
                    ))}
                  </div>
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
                            className="w-32 md:w-40 text-center text-5xl md:text-7xl font-black bg-transparent outline-none transition-colors focus:scale-110 text-text-main"
                            min="1"
                            autoFocus
                          />
                          <div className="text-label-sm md:text-xs font-black uppercase tracking-[0.2em] mt-2 text-text-main/50">{t('writing_minutes')}</div>
                        </div>
                      )}
                      {setupMode === 'words-config' && (
                        <div className="flex flex-col items-center">
                          <input 
                            type="number" 
                            value={wordGoal}
                            onChange={(e) => setWordGoal(Number(e.target.value))}
                            className="w-40 md:w-48 text-center text-5xl md:text-7xl font-black bg-transparent outline-none transition-colors focus:scale-110 text-text-main"
                            min="10"
                            step="50"
                            autoFocus
                          />
                          <div className="text-label-sm md:text-xs font-black uppercase tracking-[0.2em] mt-2 text-text-main/50">{t('writing_words')}</div>
                        </div>
                      )}
                      {setupMode === 'finish-by-config' && (
                        <div className="flex flex-col items-center">
                          <input 
                            type="time" 
                            value={targetTime || ''}
                            onChange={(e) => { setTargetTime(e.target.value); setFinishByError(false); }}
                            className={`w-56 md:w-64 text-center text-5xl md:text-7xl font-black bg-transparent outline-none transition-colors focus:scale-110 ${
                              finishByError ? 'text-accent-danger' : 'text-text-main'
                            }`}
                            autoFocus
                          />
                          <div className="text-label-sm md:text-xs font-black uppercase tracking-[0.2em] mt-2 text-text-main/50">{t('writing_time')}</div>
                          {finishByError && (
                            <div className="text-xs text-accent-danger mt-2 font-medium">
                              {t('error_target_time_in_past') || 'Выберите время в будущем'}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="w-full flex flex-col gap-2 md:gap-3">
                      <Button
                        variant="primary"
                        size="lg"
                        onClick={() => {
                          // [L-08] валидация времени finish-by: должно быть в будущем
                          if (setupMode === 'finish-by-config' && targetTime) {
                            const [hoursStr, minutesStr] = targetTime.split(':');
                            const hours = Number(hoursStr);
                            const minutes = Number(minutesStr);
                            if (Number.isNaN(hours) || Number.isNaN(minutes)) {
                              setFinishByError(true);
                              return;
                            }
                            const target = new Date();
                            target.setHours(hours, minutes, 0, 0);
                            if (target <= new Date()) {
                              setFinishByError(true);
                              return;
                            }
                          }
                          setFinishByError(false);
                          startCountdown(setupMode === 'timer-config' ? 'timer' : setupMode === 'words-config' ? 'words' : 'finish-by');
                        }}
                        className="w-full py-4 md:py-5 rounded-2xl md:rounded-[1.5rem] font-black text-base md:text-lg hover:scale-[1.02] active:scale-[0.98] shadow-[0_0_20px_var(--brand-soft)]/30"
                      >
                        {t('writing_start')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="md"
                        onClick={() => setSetupMode('selection')}
                        className="w-full py-2 text-xs md:text-sm font-bold text-text-main/50 hover:text-text-main"
                      >
                        {t('writing_back')}
                      </Button>
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
                        <Button
                          type="button"
                          key={session.localId || session.cloudId}
                          variant="ghost"
                          size="sm"
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
                                <div className="text-label-sm font-bold uppercase tracking-wider text-text-main/50">
                                  {session.totalWords} {t('writing_words')} · {formatTime(session.totalDuration)}
                                </div>
                              </div>
                            </div>
                            <div className="text-label-sm font-black uppercase tracking-widest px-2 py-1 rounded-full bg-white/10 text-text-main/50">
                              {session.lastSessionAt ? format(new Date(session.lastSessionAt), 'd MMM', { locale: dateLocale }) : ''}
                            </div>
                          </div>
                        </Button>
                      ))
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="md"
                    onClick={() => setSetupMode(null)}
                    className="w-full py-3 md:py-4 text-xs md:text-sm font-bold text-text-main/50 hover:text-text-main"
                  >
                    {t('writing_cancel')}
                  </Button>
                </div>
              )}


            </div>

            {setupMode === 'selection' && (
              <div className="px-10 py-6 border-t flex justify-center bg-white/5 border-border-subtle">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSetupMode(null)}
                  className="text-xs font-black uppercase tracking-[0.2em] transition-[letter-spacing] hover:tracking-[0.3em] text-text-main/50 hover:text-text-main"
                >
                  {t('writing_cancel')}
                </Button>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </>
  );
}
