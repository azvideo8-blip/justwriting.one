import React, { Suspense, lazy } from 'react';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useShallow } from 'zustand/react/shallow';
import { useLanguage } from '../../../shared/i18n';
import { formatTime } from '../../../core/utils/formatTime';
import { cn } from '../../../core/utils/utils';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';
import { ModalShell } from '../../../shared/components/ModalShell';
import { Loader2, Mic, MicOff, Save, Square, X } from 'lucide-react';
import { DictationWave } from './DictationBar';
import { previewDictationCost, useDictation } from '../hooks/useDictation';
import { dismissVoiceNotice, voiceNoticeDecision } from '../hooks/useGuardedSpeechInput';
import { getCurrentUser } from '../../../core/auth';
import { useEncryptionStore } from '../../../core/crypto/useEncryptionStore';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import type { VoiceNotice } from './MobileVoiceNoticeSheet';
import { useExitLinger } from '../../../shared/hooks/useExitLinger';

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
  const { t, tp } = useLanguage();
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
  // MQ-5: закрытие листа не стирает его текст — он нужен на время ухода вниз.
  const [voiceOpen, setVoiceOpen] = React.useState(false);
  const voiceMounted = useExitLinger(voiceOpen);
  // SA-25: жёлтая точка у микрофона объясняла себя только в aria-label. Предупреждение
  // человек уже прочитал в листе MF-5 (нажал «Записать») — тогда точка молчит, пока сейф
  // открыт; запертый сейф или ни разу не открытый лист — точка остаётся.
  const vaultUnlocked = useEncryptionStore(s => s.isVaultUnlocked);
  const showVaultWarn = isVaultActive && !isListening && (!vaultUnlocked || !voiceNoticeSeen());

  // MF-5: микрофон на телефоне. Отмеченное «Больше не показывать» — старт сразу,
  // в том же нажатии; иначе — лист, и старт уже из его «Записать».
  const onMic = () => {
    if (isListening) { toggle(); return; }
    const decision = voiceNoticeDecision(getCurrentUser()?.uid ?? null, isVaultActive);
    if (decision === 'start') { dictation.startAfterNotice(); return; }
    void previewDictationCost().then(remaining => {
      setVoiceNotice({ vault: decision === 'vault', remaining });
      setVoiceOpen(true);
    });
  };
  const onRecord = (dismiss: boolean) => {
    if (dismiss) dismissVoiceNotice(getCurrentUser()?.uid ?? null);
    setVoiceOpen(false);
    dictation.startAfterNotice();
  };
  const isIdle = status === 'idle';
  // MQ-3: восстановленный черновик сохраняется сразу, без начатой сессии.
  const canSave = !isIdle || wordCount > 0;
  const isPaused = status === 'paused';
  // MF-3: одна строка в чипе — режим, время, слова. Числа не обрезаются, режется
  // только название режима. Дзен оставляет состояние и время.
  // MQ-14: слово целиком («37 слов»), а не «37 сл»; «На паузе» — состояние, а не кнопка «Пауза».
  const words = `${sessionWords}${showWordGoal ? `/${wordGoal}` : ''} ${tp('writing_words', showWordGoal ? wordGoal : sessionWords)}`;
  const chipLead = isPaused ? `⏸ ${t('writing_paused_state')}` : t(MODE_LABEL[sessionModeType]);
  const chipTail = isIdle ? '' : hideStats ? clock : `${clock} · ${words}`;

  // MB-5: панель стоит в общем столбце с панелью записи, поэтому её собственный
  // bottom ушёл в MobileWriteScreen — иначе столбец нельзя было согласовать.
  const toolbarStyle = {
    border: streamMode ? '1px solid var(--accent-danger)' : '1px solid var(--border-light)',
    boxShadow: streamMode ? '0 0 12px color-mix(in srgb, var(--accent-danger) 20%, transparent)' : 'none',
  };

  const longPressTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // SA-23 (W8): удержание 3 с для выхода из потока было невидимым — теперь значок режима заливается.
  const [holding, setHolding] = React.useState(false);

  const handleTouchStart = () => {
    if (!streamMode || !onToggleStreamMode) return;
    setHolding(true);
    longPressTimer.current = setTimeout(() => {
      setHolding(false);
      setShowExitConfirm(true);
    }, 3000);
  };

  const handleTouchEnd = () => {
    setHolding(false);
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
        <div className="absolute -top-5 left-1/2 -translate-x-1/2 overflow-hidden bg-[var(--accent-danger)] text-[var(--bg-base)] text-[11px] font-semibold px-2 py-0.5 rounded-full pointer-events-none shadow-[0_2px_4px_color-mix(in_srgb,var(--accent-danger)_20%,transparent)]">
          <span
            data-testid="stream-hold-fill"
            data-holding={holding}
            aria-hidden="true"
            className="absolute inset-0 origin-left bg-[var(--bg-base)]/40"
            style={{ transform: holding ? 'scaleX(1)' : 'scaleX(0)', transition: holding ? 'transform 3000ms linear' : 'transform 200ms ease-out' }}
          />
          <span className="relative">{t('stream_mode_label')}</span>
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
            className="press w-11 h-11 shrink-0 rounded-xl flex items-center justify-center border border-[var(--border-light)] text-[var(--text-muted)] disabled:opacity-40"
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
              className="press w-11 h-11 shrink-0 rounded-full flex items-center justify-center bg-accent-danger text-[var(--bg-base)]"
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
          className="press flex min-h-11 min-w-0 flex-1 items-center gap-1 rounded-full border border-[var(--border-light)] bg-[var(--surface-card)] px-3 text-[13px] font-medium text-[var(--text-muted)] tabular-nums"
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
                    ? "border-accent-danger bg-accent-danger/10 text-accent-danger"
                    : showVaultWarn
                    ? "border-accent-warning/50 bg-accent-warning/5 text-accent-warning"
                    : "border-[var(--border-light)] bg-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]"
                )}
                icon={isListening ? <MicOff size={18} /> : <Mic size={18} />}
              />
              {/* SA-23 (W10): запись — статичная точка, а не пульс в краю глаза во время письма. */}
              {isListening && (
                <span aria-hidden="true" className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-accent-danger pointer-events-none" />
              )}
              {showVaultWarn && (
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
            disabled={!canSave}
            aria-label={t('topbar_save')}
            className={cn(
              "press w-11 h-11 shrink-0 rounded-xl flex items-center justify-center transition-opacity",
              canSave ? "cursor-pointer opacity-100" : "cursor-default opacity-45"
            )}
            style={{ background: 'var(--text-main)', color: 'var(--bg-base)' }}
          >
            <Save size={18} aria-hidden="true" />
          </button>
        </div>
        </>
      )}

      {voiceMounted && voiceNotice && (
        <Suspense fallback={null}>
          <MobileVoiceNoticeSheet open={voiceOpen} notice={voiceNotice} onCancel={() => setVoiceOpen(false)} onRecord={onRecord} />
        </Suspense>
      )}

      {/* MQ-15 (W9, N-11): лист выхода из потока — ModalShell с порталом. Раньше он лежал внутри
          панели с backdrop-blur, и `fixed inset-0` считался от панели высотой ~68 px, а не от экрана. */}
      <ModalShell open={showExitConfirm} onClose={() => setShowExitConfirm(false)} labelId="stream-exit-title" variant="sheet">
        <div className="p-6 space-y-6 pb-[calc(env(safe-area-inset-bottom,16px)+16px)]">
          <div className="text-center space-y-2">
            <h2 id="stream-exit-title" className="text-lg font-bold text-text-main">
              {t('stream_mode_exit_confirm')}
            </h2>
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
        </div>
      </ModalShell>
    </div>
  );
}

function voiceNoticeSeen(): boolean {
  try { return localStorage.getItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN_V2) === '1'; } catch { return false; }
}
