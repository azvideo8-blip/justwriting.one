import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Zap, Timer, Target, Clock, Sparkles, ChevronLeft, X } from 'lucide-react';
import { useLanguage } from '../../../core/i18n';
import { cn } from '../../../core/utils/utils';
import { useTimerStore } from '../store/useTimerStore';
import { SetupMode } from '../WritingSetup';

const PROMPT_KEYS = [
  { key: 'morning', promptKeys: ['prompt_morning_1', 'prompt_morning_2', 'prompt_morning_3'] },
  { key: 'reflect', promptKeys: ['prompt_reflect_1', 'prompt_reflect_2', 'prompt_reflect_3'] },
  { key: 'creative', promptKeys: ['prompt_creative_1', 'prompt_creative_2', 'prompt_creative_3'] },
] as const;

interface MobileSessionSetupSheetProps {
  setupMode: SetupMode;
  setSetupMode: (mode: SetupMode) => void;
  startCountdown: (type: 'stopwatch' | 'timer' | 'words' | 'finish-by') => void;
  countdown: number | null;
  onSetPromptTitle?: (title: string) => void;
}

export function MobileSessionSetupSheet({
  setupMode,
  setSetupMode,
  startCountdown,
  countdown,
  onSetPromptTitle,
}: MobileSessionSetupSheetProps) {
  const { t } = useLanguage();
  const timerDuration = useTimerStore(s => s.timerDuration);
  const setTimerDuration = useTimerStore(s => s.setTimerDuration);
  const wordGoal = useTimerStore(s => s.wordGoal);
  const setWordGoal = useTimerStore(s => s.setWordGoal);
  const targetTime = useTimerStore(s => s.targetTime);
  const setTargetTime = useTimerStore(s => s.setTargetTime);
  const [finishByError, setFinishByError] = useState(false);

  // Vibration on countdown ticks
  useEffect(() => {
    if (countdown !== null && countdown > 0 && typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(80);
      } catch (e) {
        // Safe fallback if permission is blocked
      }
    }
  }, [countdown]);

  if (!setupMode) return null;

  const handleStartWithValidation = () => {
    if (setupMode === 'finish-by-config' && targetTime) {
      const [hours, minutes] = targetTime.split(':').map(Number);
      const target = new Date();
      target.setHours(hours, minutes, 0, 0);
      if (target <= new Date()) {
        setFinishByError(true);
        return;
      }
    }
    setFinishByError(false);
    startCountdown(
      setupMode === 'timer-config' ? 'timer' :
      setupMode === 'words-config' ? 'words' : 'finish-by'
    );
  };

  const handlePromptSelect = (prompt: string) => {
    onSetPromptTitle?.(prompt);
    startCountdown('stopwatch');
  };

  return (
    <>
      {/* 3-2-1 Countdown Overlay */}
      <AnimatePresence>
        {setupMode === 'countdown' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[150] bg-surface-base flex flex-col items-center justify-center"
          >
            <motion.div
              key={countdown}
              initial={{ scale: 0.3, opacity: 0, filter: 'blur(8px)' }}
              animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
              exit={{ scale: 1.5, opacity: 0, filter: 'blur(4px)' }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className="text-8xl font-black text-text-main font-sans tracking-tight"
            >
              {countdown === 0 ? t('writing_go') : countdown}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Slide-up Bottom Sheet Panel */}
      {setupMode !== 'countdown' && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm">
          {/* Dismiss Back-tap Zone */}
          <div className="absolute inset-0" onClick={() => setSetupMode(null)} />

          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            className="relative z-10 w-full max-w-lg bg-surface-card border-t border-white/[0.06] rounded-t-[28px] overflow-hidden flex flex-col max-h-[90vh] shadow-[0_-8px_32px_rgba(0,0,0,0.4)]"
          >
            {/* Grab Handle */}
            <div className="flex justify-center py-3">
              <div className="w-12 h-1.5 rounded-full bg-white/10" />
            </div>

            {/* Back / Close Actions */}
            <div className="flex justify-between items-center px-6 pb-2">
              {setupMode !== 'selection' ? (
                <button
                  onClick={() => setSetupMode('selection')}
                  className="flex items-center gap-1.5 text-xs font-semibold text-text-main/55 bg-transparent border-none cursor-pointer py-2 pr-4 pl-0"
                >
                  <ChevronLeft size={16} />
                  {t('writing_back')}
                </button>
              ) : (
                <span className="text-sm font-bold text-text-main/30 uppercase tracking-widest">
                  {t('writing_select_mode')}
                </span>
              )}
              <button
                onClick={() => setSetupMode(null)}
                className="w-8 h-8 rounded-full bg-white/[0.04] border-none flex items-center justify-center text-text-main/40 hover:text-text-main/70 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-6 pb-8 overflow-y-auto no-scrollbar flex-1">
              {/* Selection Screen */}
              {setupMode === 'selection' && (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <p className="text-xs text-text-main/45 font-medium leading-relaxed">
                      {t('writing_how_to_write')}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-2.5">
                    {[
                      { id: 'stopwatch', icon: Zap, label: 'writing_mode_flow', desc: 'writing_mode_flow_desc', color: 'text-amber-400', bg: 'bg-amber-400/8' },
                      { id: 'timer-config', icon: Timer, label: 'writing_mode_timer', desc: 'writing_mode_timer_desc', color: 'text-blue-400', bg: 'bg-blue-400/8' },
                      { id: 'words-config', icon: Target, label: 'writing_mode_words', desc: 'writing_mode_words_desc', color: 'text-rose-400', bg: 'bg-rose-400/8' },
                      { id: 'finish-by-config', icon: Clock, label: 'writing_mode_deadline', desc: 'writing_mode_deadline_desc', color: 'text-emerald-400', bg: 'bg-emerald-400/8' },
                      { id: 'prompts', icon: Sparkles, label: 'writing_mode_prompts', desc: 'writing_mode_prompts_desc', color: 'text-violet-400', bg: 'bg-violet-400/8' },
                    ].map((mode) => (
                      <button
                        key={mode.id}
                        onClick={() => mode.id === 'stopwatch' ? startCountdown('stopwatch') : setSetupMode(mode.id as SetupMode)}
                        className="p-4 rounded-2xl border border-white/[0.05] bg-white/[0.02] flex items-center gap-4 text-left w-full active:bg-white/[0.07] active:scale-[0.99] transition-all cursor-pointer"
                        style={{ minHeight: 64 }}
                      >
                        <div className={cn("p-2.5 rounded-xl shrink-0", mode.bg, mode.color)}>
                          <mode.icon size={20} strokeWidth={2.2} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-sm text-text-main leading-tight">
                            {t(mode.label)}
                          </div>
                          <div className="text-xs text-text-main/40 leading-tight mt-0.5">
                            {t(mode.desc)}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Configurations Panel */}
              {(setupMode === 'timer-config' || setupMode === 'words-config' || setupMode === 'finish-by-config') && (
                <div className="space-y-6 pt-2">
                  <div className="text-center">
                    <h3 className="text-xl font-bold text-text-main">
                      {setupMode === 'timer-config' ? t('writing_set_timer') :
                       setupMode === 'words-config' ? t('writing_mode_words') : t('writing_mode_deadline')}
                    </h3>
                  </div>

                  <div className="flex flex-col items-center gap-6">
                    {/* Input Block */}
                    <div className="flex flex-col items-center w-full">
                      {setupMode === 'timer-config' && (
                        <>
                          <div className="flex items-center justify-center">
                            <input
                              type="number"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={timerDuration / 60 || ''}
                              onChange={(e) => setTimerDuration(Number(e.target.value) * 60)}
                              className="w-32 text-center text-6xl font-black bg-transparent border-b border-white/10 py-1 outline-none text-text-main"
                              min="1"
                              placeholder="15"
                              autoFocus
                            />
                          </div>
                          <span className="text-[10px] font-bold uppercase tracking-widest text-text-main/40 mt-2">
                            {t('writing_minutes')}
                          </span>

                          {/* Quick presets for timer */}
                          <div className="flex gap-2.5 mt-5">
                            {[5, 10, 15, 25, 45].map((mins) => (
                              <button
                                key={mins}
                                onClick={() => setTimerDuration(mins * 60)}
                                className={cn(
                                  "px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer",
                                  timerDuration === mins * 60
                                    ? "bg-brand-primary/10 border-brand-primary text-brand-primary"
                                    : "bg-white/[0.02] border-white/[0.06] text-text-main/60"
                                )}
                              >
                                {mins} {t('goal_time_min')}
                              </button>
                            ))}
                          </div>
                        </>
                      )}

                      {setupMode === 'words-config' && (
                        <>
                          <div className="flex items-center justify-center">
                            <input
                              type="number"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={wordGoal || ''}
                              onChange={(e) => setWordGoal(Number(e.target.value))}
                              className="w-40 text-center text-6xl font-black bg-transparent border-b border-white/10 py-1 outline-none text-text-main"
                              min="10"
                              placeholder="500"
                              autoFocus
                            />
                          </div>
                          <span className="text-[10px] font-bold uppercase tracking-widest text-text-main/40 mt-2">
                            {t('writing_words')}
                          </span>

                          {/* Quick presets for words */}
                          <div className="flex flex-wrap justify-center gap-2.5 mt-5">
                            {[100, 250, 500, 750, 1000].map((words) => (
                              <button
                                key={words}
                                onClick={() => setWordGoal(words)}
                                className={cn(
                                  "px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer",
                                  wordGoal === words
                                    ? "bg-brand-primary/10 border-brand-primary text-brand-primary"
                                    : "bg-white/[0.02] border-white/[0.06] text-text-main/60"
                                )}
                              >
                                {words} {t('home_words_short')}
                              </button>
                            ))}
                          </div>
                        </>
                      )}

                      {setupMode === 'finish-by-config' && (
                        <>
                          <div className="flex items-center justify-center">
                            <input
                              type="time"
                              value={targetTime || ''}
                              onChange={(e) => { setTargetTime(e.target.value); setFinishByError(false); }}
                              className={cn(
                                "w-52 text-center text-5xl font-black bg-transparent border-b border-white/10 py-1 outline-none",
                                finishByError ? "text-red-400 border-red-500/50" : "text-text-main"
                              )}
                              autoFocus
                            />
                          </div>
                          <span className="text-[10px] font-bold uppercase tracking-widest text-text-main/40 mt-2">
                            {t('writing_time')}
                          </span>
                          {finishByError && (
                            <div className="text-xs text-red-400 mt-2 font-medium">
                              {t('error_target_time_in_past') || 'Выберите время в будущем'}
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Launch Action */}
                    <div className="w-full pt-4">
                      <button
                        onClick={handleStartWithValidation}
                        className="w-full py-4 rounded-2xl font-bold text-sm bg-text-main text-surface-base active:scale-[0.98] transition-all cursor-pointer shadow-[0_4px_16px_rgba(255,255,255,0.08)]"
                      >
                        {t('writing_start')}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Prompts list selection */}
              {setupMode === 'prompts' && (
                <div className="space-y-4 pt-2">
                  <div className="text-center">
                    <h3 className="text-xl font-bold text-text-main">
                      {t('writing_mode_prompts')}
                    </h3>
                  </div>

                  <div className="space-y-4">
                    {PROMPT_KEYS.map(cat => (
                      <div key={cat.key} className="space-y-1.5">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-text-main/40 pl-1">
                          {t(`prompts_category_${cat.key}`)}
                        </div>
                        <div className="space-y-2">
                          {cat.promptKeys.map((promptKey, i) => (
                            <button
                              key={i}
                              onClick={() => handlePromptSelect(t(promptKey))}
                              className="w-full text-left px-4 py-3 rounded-xl border border-white/[0.05] bg-white/[0.02] active:bg-white/[0.06] text-xs text-text-main/80 active:text-text-main transition-all cursor-pointer leading-relaxed"
                            >
                              {t(promptKey)}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </>
  );
}
