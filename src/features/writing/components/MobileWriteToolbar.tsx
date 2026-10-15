import React, { Suspense, lazy } from 'react';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useShallow } from 'zustand/react/shallow';
import { useLanguage } from '../../../shared/i18n';
import { formatTime } from '../../../core/utils/formatTime';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../../core/utils/utils';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';
import { Loader2, Mic, MicOff, Save, Square, X } from 'lucide-react';
import { DictationWave } from './DictationBar';
import { previewDictationCost, useDictation } from '../hooks/useDictation';
import { dismissVoiceNotice, voiceNoticeDecision } from '../hooks/useGuardedSpeechInput';
import { getCurrentUser } from '../../../core/auth';
import type { VoiceNotice } from './MobileVoiceNoticeSheet';

// MF-5: лист «Голосовой ввод» — ленивый кусок (запас бюджета index ~200 байт).
const MobileVoiceNoticeSheet = lazy(() => import('./MobileVoiceNoticeSheet').then(m => ({ default: m.MobileVoiceNoticeSheet })));
import { dictationMicLabel } from '../hooks/dictationMicLabel';
import { MODE_LABEL, sessionClockSeconds } from '../utils/sessionModeLabels';
import type { SessionType } from '../store/types';

interface MobileWriteToolbarProps {
  onStop: () => void;
  /** MC-1/MF-3: тап по чипу режима — лист сессии (пауза, новая заметка, ИИ, режим). */
  onOpenSetup?: (() => void) | undefined;
  streamMode?: boolean | undefined;
  onToggleStreamMode?: (() => void) | undefined;
  /** MC-1: режим показывает экран письма (у него `session.sessionType`);
   *  без пропа панель берёт тот же `sessionType` из стора. */
  sessionType?: SessionType | undefined;
  /** MB-2: дзен на телефоне прячет статистику, но не кнопки. */
  hideStats?: boolean | undefined;
}

export function MobileWriteToolbar({
  onStop, onOpenSetup, streamMode, onToggleStreamMode, hideStats, sessionType: sessionTypeProp
}: MobileWriteToolbarProps) {
  const { t } = useLanguage();
  const wordCount = useContentStore(s => s.wordCount);
  const dictation = useDictation();
  const { isListening, toggle, hasSupport, isVaultActive, aiNoticeRemaining } = dictation;
  const { seconds, wordGoal, timerDuration, sessionStartWords, sessionStartSeconds, status, sessionType } = useTimerStore(
    useShallow(s => ({
      seconds: s.seconds,
      wordGoal: s.wordGoal,
      timerDuration: s.timerDuration,
      sessionStartWords: s.sessionStartWords,
      sessionStartSeconds: s.sessionStartSeconds,
      status: s.status,
      sessionType: s.sessionType,
    }))
  );

  const sessionWords = Math.max(0, wordCount - sessionStartWords);
  const sessionSeconds = Math.max(0, seconds - sessionStartSeconds);
  const sessionModeType = sessionTypeProp ?? sessionType;
  const showWordGoal = sessionModeType === 'words' && wordGoal > 0;
  const clock = formatTime(sessionClockSeconds(sessionModeType, timerDuration, sessionSeconds));

  const [showExitConfirm, setShowExitConfirm] = React.useState(false);
  const [voiceNotice, setVoiceNotice] = React.useState<VoiceNotice | null>(null);

  // MF-5: микрофон на телефоне. Отмеченное «Больше не показывать» — старт сразу,
  // в том же нажатии; иначе — лист, и старт уже из его «Записать».
  const onMic = () => {
    if (isListening) { toggle(); return; }
    const decision = voiceNoticeDecision(getCurrentUser()?.uid ?? null, isVaultActive);
    if (decision === 'start') { dictation.startAfterNotice(); return; }
    void previewDictationCost().then(remaining => setVoiceNotice({ vault: decision === 'vault', remaining }));
  };
  const onRecord = (dismiss: boolean) => {
    if (dismiss) dismissVoiceNotice(getCurrentUser()?.uid ?? null);
    setVoiceNotice(null);
    dictation.startAfterNotice();
  };
  const isIdle = status === 'idle';
  const isPaused = status === 'paused';
  // MF-3: одна строка в чипе — режим, время, слова. Числа не обрезаются, режется
  // только название режима. Дзен оставляет состояние и время.
  const words = `${sessionWords}${showWordGoal ? `/${wordGoal}` : ''} ${t('writing_words_short')}`;
  const chipLead = isPaused ? `⏸ ${t('pause')}` : t(MODE_LABEL[sessionModeType]);
  const chipTail = isIdle ? '' : hideStats ? clock : `${clock} · ${words}`;

  // MB-5: панель стоит в общем столбце с панелью записи, поэтому её собственный
  // bottom ушёл в MobileWriteScreen — иначе столбец нельзя было согласовать.
  const toolbarStyle = {
    border: streamMode ? '1px solid var(--accent-danger)' : '1px solid var(--border-light)',
    boxShadow: streamMode ? '0 0 12px color-mix(in srgb, var(--accent-danger) 20%, transparent)' : 'none',
  };

  const longPressTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTouchStart = () => {
    if (!streamMode || !onToggleStreamMode) return;
    longPressTimer.current = setTimeout(() => {
      setShowExitConfirm(true);
    }, 3000);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
  };

  return (
    <div
      data-write-toolbar
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchEnd}
      className="w-full bg-[var(--surface-card)] backdrop-blur-md rounded-[20px] py-3 px-4 flex items-center gap-0 transition-[border-color,box-shadow] duration-300"
      style={toolbarStyle}
    >
      {streamMode && (
        <div className="absolute -top-5 left-1/2 -translate-x-1/2 bg-[var(--accent-danger)] text-[var(--bg-base)] text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-[0.05em] pointer-events-none shadow-[0_2px_4px_color-mix(in_srgb,var(--accent-danger)_20%,transparent)]">
          {t('stream_mode_label')}
        </div>
      )}
      {hasSupport && (dictation.phase === 'recording' || dictation.phase === 'processing') ? (
        /* MF-4: запись идёт в самой панели, без карточки над ней: × отменяет,
           ■ останавливает, посередине волна (или последние слова распознавания) и
           время. Высота панели та же, что без записи. */
        <div className="flex min-w-0 flex-1 items-center gap-2" data-dictation-row data-phase={dictation.phase}>
          <button
            type="button"
            onClick={dictation.cancel}
            disabled={dictation.phase === 'processing'}
            aria-label={t('voice_cancel')}
            className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center border border-[var(--border-light)] text-[var(--text-muted)] disabled:opacity-40"
          >
            <X size={18} aria-hidden="true" />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2" aria-live="polite">
            {dictation.phase === 'processing' ? (
              <span className="flex min-w-0 items-center gap-2 text-[13px] text-[var(--text-muted)]">
                <Loader2 size={16} className="shrink-0 animate-spin" aria-hidden="true" />
                <span className="truncate">{t('voice_processing')}</span>
              </span>
            ) : dictation.interimText || dictation.liveText ? (
              <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-muted)]" data-dictation-live>
                {dictation.interimText || dictation.liveText.split(' ').slice(-8).join(' ')}
              </span>
            ) : (
              <span className="min-w-0 flex-1 overflow-hidden"><DictationWave level={dictation.level} levels={dictation.levels} levelFailed={dictation.levelFailed} /></span>
            )}
            {dictation.phase === 'recording' && (
              <span className="shrink-0 font-mono text-[13px] tabular-nums text-[var(--text-muted)]" data-dictation-timer>{formatTime(dictation.seconds)}</span>
            )}
          </div>
          {dictation.phase === 'recording' && (
            <button
              type="button"
              onClick={dictation.stop}
              aria-label={t('voice_stop_dictation')}
              className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center bg-accent-danger text-[var(--bg-base)]"
            >
              <Square size={16} fill="currentColor" aria-hidden="true" />
            </button>
          )}
        </div>
      ) : (
        <>
        <button
          type="button"
          onClick={() => onOpenSetup?.()}
          aria-label={t('writing_mode_token')}
          data-write-chip
          className="flex min-h-11 min-w-0 flex-1 items-center gap-1 rounded-full border border-[var(--border-light)] bg-[var(--surface-card)] px-3 text-[13px] font-medium text-[var(--text-muted)] tabular-nums"
        >
          {hideStats && !isIdle
            ? <span aria-hidden="true" className="shrink-0">{isPaused ? '⏸' : '▶'}</span>
            : <span className="truncate">{chipLead}</span>}
          {chipTail && <span className="shrink-0 whitespace-nowrap">{hideStats ? ` ${chipTail}` : ` · ${chipTail}`}</span>}
          <span aria-hidden="true" className="shrink-0">▾</span>
        </button>

        <div className="flex gap-2 shrink-0 ml-2">
          {hasSupport && (
            <div className="relative">
              <IconButton
                onClick={onMic}
                label={dictationMicLabel(isListening, isVaultActive, aiNoticeRemaining !== null, t)}
                className={cn(
                  "w-11 h-11 rounded-xl flex items-center justify-center cursor-pointer border shrink-0",
                  isListening
                    ? "border-accent-danger bg-accent-danger/10 text-accent-danger animate-pulse"
                    : isVaultActive
                    ? "border-accent-warning/50 bg-accent-warning/5 text-accent-warning"
                    : "border-[var(--border-light)] bg-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]"
                )}
                icon={isListening ? <MicOff size={18} /> : <Mic size={18} />}
              />
              {isVaultActive && !isListening && (
                <span
                  className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-accent-warning pointer-events-none"
                  title={t('voice_vault_badge')}
                />
              )}
            </div>
          )}

          {/* MF-3: «Сохранить» — значок дискеты 44 px вместо слова «Готово» (решение владельца). */}
          <button
            type="button"
            onClick={onStop}
            disabled={isIdle}
            aria-label={t('topbar_save')}
            className={cn(
              "w-11 h-11 shrink-0 rounded-xl flex items-center justify-center transition-opacity",
              isIdle ? "cursor-default opacity-45" : "cursor-pointer opacity-100"
            )}
            style={{ background: 'var(--text-main)', color: 'var(--bg-base)' }}
          >
            <Save size={18} aria-hidden="true" />
          </button>
        </div>
        </>
      )}

      {voiceNotice && (
        <Suspense fallback={null}>
          <MobileVoiceNoticeSheet notice={voiceNotice} onCancel={() => setVoiceNotice(null)} onRecord={onRecord} />
        </Suspense>
      )}

      <AnimatePresence>
        {showExitConfirm && (
          <div
            // color-ok: затемнение одинаково в любой теме.
            className="fixed inset-0 z-[var(--z-sheet)] flex items-end justify-center bg-black/60 backdrop-blur-sm">
            <div className="absolute inset-0" onClick={() => setShowExitConfirm(false)} />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              // color-ok: тень листа — чёрная в любой теме.
              className="relative z-10 w-full max-w-lg bg-surface-popup border-t border-border-subtle rounded-t-[28px] overflow-hidden flex flex-col p-6 space-y-6 shadow-[0_-8px_32px_rgba(0,0,0,0.4)] pb-[calc(env(safe-area-inset-bottom,16px)+16px)]"
            >
              <div className="flex justify-center">
                <div className="w-12 h-1.5 rounded-full bg-text-main/10" />
              </div>
              <div className="text-center space-y-2">
                <h3 className="text-lg font-bold text-text-main">
                  {t('stream_mode_exit_confirm')}
                </h3>
                <p className="text-sm text-text-main/60">
                  {t('stream_mode_exit_desc')}
                </p>
              </div>
              <div className="flex gap-3">
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => setShowExitConfirm(false)}
                  className="flex-1 py-3.5 rounded-2xl border border-border-subtle text-text-main font-bold text-sm min-h-[44px]"
                >
                  {t('writing_cancel')}
                </Button>
                <Button
                  variant="danger"
                  size="md"
                  onClick={() => {
                    setShowExitConfirm(false);
                    onToggleStreamMode?.();
                  }}
                  className="flex-1 py-3.5 rounded-2xl font-bold text-sm text-white min-h-[44px]"
                >
                  {t('storage_delete_confirm')}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
