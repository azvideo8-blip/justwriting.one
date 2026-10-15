import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Zap, Timer, Target, Clock, ChevronLeft, Check, X } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n';
import { ModalShell, SECTION_LABEL, SheetTitle } from '../../../shared/components/ModalShell';
import { cn } from '../../../core/utils/utils';
import { useTimerStore } from '../store/useTimerStore';
import { SetupMode } from './WritingSetup';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';


interface MobileSessionSetupSheetProps {
  setupMode: SetupMode;
  setSetupMode: (mode: SetupMode) => void;
  startCountdown: (type: 'stopwatch' | 'timer' | 'words' | 'finish-by') => void;
  countdown: number | null;
  /** MF-3: на телефоне пауза, «Новая заметка» и ИИ-помощник ушли из панели письма
   *  сюда — тремя строками над режимами. Без пропа (десктоп) строк нет. */
  sessionRows?: SessionRows | undefined;
}

export interface SessionRows {
  status: 'idle' | 'writing' | 'paused';
  hasText: boolean;
  onTogglePause: () => void;
  onNew: () => void;
  onOpenAI: () => void;
}

export function MobileSessionSetupSheet({
  setupMode,
  setSetupMode,
  startCountdown,
  countdown,
  sessionRows,
}: MobileSessionSetupSheetProps) {
  const { t, tp } = useLanguage();
  const sessionType = useTimerStore(s => s.sessionType);
  const timerDuration = useTimerStore(s => s.timerDuration);
  const setTimerDuration = useTimerStore(s => s.setTimerDuration);
  const wordGoal = useTimerStore(s => s.wordGoal);
  const setWordGoal = useTimerStore(s => s.setWordGoal);
  const targetTime = useTimerStore(s => s.targetTime);
  const setTargetTime = useTimerStore(s => s.setTargetTime);
  const [finishByError, setFinishByError] = useState(false);

  // Vibration on countdown ticks
  useEffect(() => {
    if (countdown !== null && countdown > 0 && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(80);
      } catch {
        // Safe fallback if permission is blocked
      }
    }
  }, [countdown]);

  const handleStartWithValidation = () => {
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
        target.setDate(target.getDate() + 1);
      }
    }
    setFinishByError(false);
    startCountdown(
      setupMode === 'timer-config' ? 'timer' :
      setupMode === 'words-config' ? 'words' : 'finish-by'
    );
  };


  return (
    <>
      {/* 3-2-1 Countdown Overlay */}
      {/* not-a-modal: fullscreen takeover */}
      <AnimatePresence>
        {setupMode === 'countdown' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[var(--z-sheet)] bg-surface-base flex flex-col items-center justify-center"
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

      {/* Slide-up Bottom Sheet Panel — MF-20: смонтирован всегда, open даёт уход с анимацией. */}
      {(
        <ModalShell open={!!setupMode && setupMode !== 'countdown'} onClose={() => setSetupMode(null)} labelId="setup-sheet-title" variant="sheet" className="max-h-[90vh]">
          {/* SA-23: ручку убрали — перетаскивания у листа нет, а ручка его обещала. */}
          <div className="h-3" aria-hidden="true" />

            {/* Back / Close Actions */}
            <div className="flex justify-between items-center px-6 pb-2">
              {setupMode !== 'selection' ? (
                <Button
                  onClick={() => setSetupMode('selection')}
                  className="flex items-center gap-1.5 text-xs font-semibold text-text-main/60 bg-transparent border-none cursor-pointer py-2 pr-4 pl-0"
                >
                  <ChevronLeft size={16} />
                  {t('writing_back')}
                </Button>
              ) : (
                <SheetTitle id="setup-sheet-title">{t('writing_select_mode')}</SheetTitle>
              )}
              <IconButton
                onClick={() => setSetupMode(null)}
                className="w-11 h-11 rounded-full bg-text-main/[0.05] border-none flex items-center justify-center text-text-main/60 hover:text-text-main/70 cursor-pointer"
                label={t('close')}
                icon={<X size={18} />}
              />
            </div>

            <div className="px-6 overflow-y-auto no-scrollbar flex-1 pb-[calc(env(safe-area-inset-bottom,0px)+88px)]">
              {/* Selection Screen */}
              {setupMode === 'selection' && (
                <div className="space-y-4">
                  {sessionRows && (
                    <div className="grid grid-cols-1 gap-2" data-session-rows role="group" aria-labelledby="setup-group-session">
                      <div id="setup-group-session" className={SECTION_LABEL}>{t('writing_group_session')}</div>
                      {sessionRows.status !== 'idle' && (
                        <SessionRow
                          label={sessionRows.status === 'paused' ? t('writing_resume') : t('pause')}
                          onClick={() => { setSetupMode(null); sessionRows.onTogglePause(); }}
                        />
                      )}
                      {sessionRows.hasText && (
                        <SessionRow label={t('topbar_new')} onClick={() => { setSetupMode(null); sessionRows.onNew(); }} />
                      )}
                      {/* Не переключатель: строка закрывает лист и открывает ту же панель ИИ, что раньше ✦. */}
                      <SessionRow label={`${t('ai_toggle')} ›`} onClick={() => { setSetupMode(null); sessionRows.onOpenAI(); }} />
                    </div>
                  )}
                  {/* MQ-9: две группы с подписями; иконки режимов одним приглушённым цветом
                      (статус-цвета читались как предупреждения), текущий режим отмечен. */}
                  <div className="grid grid-cols-1 gap-2.5" role="group" aria-labelledby="setup-group-how">
                    <div id="setup-group-how" className={SECTION_LABEL}>{t('writing_group_how')}</div>
                    {[
                      { id: 'stopwatch', icon: Zap, label: 'writing_mode_flow', desc: 'writing_mode_flow_desc', types: ['free', 'stopwatch'] },
                      { id: 'timer-config', icon: Timer, label: 'writing_mode_timer', desc: 'writing_mode_timer_desc', types: ['timer'] },
                      { id: 'words-config', icon: Target, label: 'writing_mode_words', desc: 'writing_mode_words_desc', types: ['words'] },
                      { id: 'finish-by-config', icon: Clock, label: 'writing_mode_deadline', desc: 'writing_mode_deadline_desc', types: ['finish-by'] },
                    ].map((mode) => {
                      const current = mode.types.includes(sessionType);
                      return (
                      <Button
                        key={mode.id}
                        onClick={() => mode.id === 'stopwatch' ? startCountdown('stopwatch') : setSetupMode(mode.id as SetupMode)}
                        aria-current={current ? 'true' : undefined}
                        className={cn(
                          "p-4 rounded-2xl border bg-text-main/[0.03] flex items-center gap-4 text-left w-full press active:bg-text-main/[0.07] cursor-pointer min-h-[64px]",
                          current ? "border-text-main/40" : "border-border-subtle",
                        )}
                      >
                        <div className="p-2.5 rounded-xl shrink-0 bg-text-main/[0.06] text-text-muted">
                          <mode.icon size={20} strokeWidth={2.2} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-sm text-text-main leading-tight">
                            {t(mode.label)}
                          </div>
                          <div className="text-xs text-text-main/60 leading-tight mt-0.5">
                            {t(mode.desc)}
                          </div>
                        </div>
                        {current && <Check size={18} className="shrink-0 text-text-main" aria-hidden="true" />}
                      </Button>
                      );
                    })}
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
                              className="w-32 text-center text-6xl font-black bg-transparent border-b border-border-subtle py-1 outline-none text-text-main"
                              min="1"
                              placeholder="15"
                              aria-label={t('writing_minutes')}
                              autoFocus
                            />
                          </div>
                          <span className={`${SECTION_LABEL} mt-2`}>
                            {t('writing_minutes')}
                          </span>

                          {/* Quick presets for timer */}
                          <div className="flex gap-2.5 mt-5">
                            {[5, 10, 15, 25, 45].map((mins) => (
                              <Button
                                key={mins}
                                onClick={() => setTimerDuration(mins * 60)}
                                className={cn(
                                  "px-3.5 py-2 rounded-xl text-xs font-semibold border transition-colors cursor-pointer",
                                  timerDuration === mins * 60
                                    ? "bg-brand-primary/10 border-brand-primary text-brand-primary"
                                    : "bg-text-main/[0.03] border-border-subtle text-text-main/60"
                                )}
                              >
                                {mins} {t('goal_time_min')}
                              </Button>
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
                              className="w-40 text-center text-6xl font-black bg-transparent border-b border-border-subtle py-1 outline-none text-text-main"
                              min="10"
                              placeholder="500"
                              aria-label={t('writing_words')}
                              autoFocus
                            />
                          </div>
                          <span className={`${SECTION_LABEL} mt-2`}>
                            {t('writing_words')}
                          </span>

                          {/* Quick presets for words */}
                          <div className="flex flex-wrap justify-center gap-2.5 mt-5">
                            {[100, 250, 500, 750, 1000].map((words) => (
                              <Button
                                key={words}
                                onClick={() => setWordGoal(words)}
                                className={cn(
                                  "px-3.5 py-2 rounded-xl text-xs font-semibold border transition-colors cursor-pointer",
                                  wordGoal === words
                                    ? "bg-brand-primary/10 border-brand-primary text-brand-primary"
                                    : "bg-text-main/[0.03] border-border-subtle text-text-main/60"
                                )}
                              >
                                {tp('archive_word_count', words)}
                              </Button>
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
                                "w-52 text-center text-5xl font-black bg-transparent border-b border-border-subtle py-1 outline-none",
                                finishByError ? "text-accent-danger border-accent-danger/50" : "text-text-main"
                              )}
                              aria-label={t('writing_time')}
                              autoFocus
                            />
                          </div>
                          <span className={`${SECTION_LABEL} mt-2`}>
                            {t('writing_time')}
                          </span>
                          {finishByError && (
                            <div className="text-xs text-accent-danger mt-2 font-medium">
                              {t('error_target_time_in_past')}
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Launch Action */}
                    <div className="w-full pt-4">
                      <Button
                        onClick={handleStartWithValidation}
                        className="w-full py-4 rounded-2xl font-bold text-sm bg-text-main text-surface-base press cursor-pointer"
                      >
                        {t('writing_start')}
                      </Button>
                    </div>
                  </div>
                </div>
              )}


            </div>{/* end overflow-y-auto */}
        </ModalShell>
      )}
    </>
  );
}

function SessionRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-11 w-full rounded-2xl border border-[var(--border-light)] px-4 text-left text-sm font-semibold text-text-main press"
    >
      {label}
    </button>
  );
}
