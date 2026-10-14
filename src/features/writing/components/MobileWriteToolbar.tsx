import React from 'react';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useShallow } from 'zustand/react/shallow';
import { useLanguage } from '../../../shared/i18n';
import { formatTime } from '../../../core/utils/formatTime';
import { getWpmHex } from '../utils/wpmColors';
import { useWritingSettings } from '../../../core/settings/WritingSettingsContext';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../../core/utils/utils';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';
import { AIToggleButton } from './AIToggleButton';
import { Mic, MicOff, Sparkles } from 'lucide-react';
import { useDictation } from '../hooks/useDictation';
import { dictationMicLabel } from '../hooks/dictationMicLabel';
import { MODE_LABEL } from '../utils/sessionModeLabels';
import type { SessionType } from '../store/types';

function DottedProgress({ pct, color }: { pct: number; color: string }) {
  const n = 16;
  const filled = Math.round(Math.min(1, pct) * n);
  const dotStyle = (i: number, filled: number, color: string) => ({
    background: i < filled ? color : 'var(--border-light)',
    boxShadow: i === filled - 1 && filled > 0 ? `0 0 5px ${color}` : 'none',
  });
  return (
    <div className="flex gap-0.5 mt-1 max-w-full overflow-hidden" >
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          className="w-[5px] h-[5px] rounded-[3px] shrink-0 transition-colors duration-300"
          style={dotStyle(i, filled, color)}
        />
      ))}
    </div>
  );
}

function MiniSpark({ history, color }: { history: { timestamp: number; wpm: number }[]; color: string }) {
  const pts = history.slice(-12);
  if (pts.length < 2) return null;
  const maxWpm = Math.max(...pts.map(p => p.wpm), 1);
  const w = 44, h = 16;
  const points = pts.map((p, i) => {
    const x = (i / (pts.length - 1)) * w;
    const y = h - (p.wpm / maxWpm) * h;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block opacity-70 max-w-full" preserveAspectRatio="xMidYMid meet" >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface MobileWriteToolbarProps {
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onGoalClick?: (() => void) | undefined;
  /** MC-1: тап по токену режима — то же окно настройки сессии, что в шапке. */
  onOpenSetup?: (() => void) | undefined;
  streamMode?: boolean | undefined;
  onToggleStreamMode?: (() => void) | undefined;
  onNew?: (() => void) | undefined;
  isRunning?: boolean | undefined;
  /** MC-1: режим показывает экран письма (у него `session.sessionType`);
   *  без пропа панель берёт тот же `sessionType` из стора. */
  sessionType?: SessionType | undefined;
  /** MB-2: дзен на телефоне прячет статистику, но не кнопки. */
  hideStats?: boolean | undefined;
}

export function MobileWriteToolbar({
  onPlay, onPause, onStop, onGoalClick, onOpenSetup, streamMode, onToggleStreamMode, onNew, hideStats, sessionType: sessionTypeProp
}: MobileWriteToolbarProps) {
  const { t } = useLanguage();
  const { effectiveHeaderVisibility, aiPanelOpen, setAiPanelOpen } = useWritingSettings();
  const { wordCount, wpm, wpmHistory } = useContentStore(
    useShallow(s => ({
      wordCount: s.wordCount,
      wpm: s.wpm,
      wpmHistory: s.wpmHistory,
    }))
  );

  const { isListening, toggle, hasSupport, isVaultActive, aiNoticeRemaining } = useDictation();
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

  const sessionWords = wordCount - sessionStartWords;
  const sessionSeconds = Math.max(0, seconds - sessionStartSeconds);
  // MP-5: панель письма показывает то же, что токен режима (0.9.39 назвал реальный
  // `sessionType`). Цель по словам живёт только в режиме слов, обратный отсчёт —
  // только в таймере и «закончить к»; в свободном потоке и секундомере время идёт
  // вперёд. Раньше и то, и другое включалось от самих чисел в настройках.
  const sessionModeType = sessionTypeProp ?? sessionType;
  const showWordGoal = sessionModeType === 'words' && wordGoal > 0;
  const showCountdown = (sessionModeType === 'timer' || sessionModeType === 'finish-by') && timerDuration > 0;
  const cellTime = showCountdown ? Math.max(0, timerDuration - sessionSeconds) : sessionSeconds;

  const [showExitConfirm, setShowExitConfirm] = React.useState(false);
  const isRunning = status === 'writing';
  const isIdle = status === 'idle';
  const wpmHex = getWpmHex(wpm);
  const wpmDotStyle = {
    background: wpmHex,
    boxShadow: status === 'writing' && wpm > 0
      ? `0 0 8px ${wpmHex}`
      : 'none',
  };
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
      <div className="flex-1 flex gap-0 empty:hidden min-w-0 overflow-hidden">
        {!hideStats && (
          /* MC-1: токен режима переехал сюда из второй строки экрана письма. До
             первой буквы на телефоне остаётся одна строка сверху и панель. */
          <button
            type="button"
            onClick={() => onOpenSetup?.()}
            aria-label={t('writing_mode_token')}
            className="flex min-h-11 shrink-0 items-center gap-1.5 max-w-[52%] clickable-target-expansion rounded-full border border-[var(--border-light)] bg-[var(--surface-card)] px-3 text-[12px] font-medium text-[var(--text-muted)]"
          >
            <span className="truncate">{t(MODE_LABEL[sessionModeType])}</span>
            <span aria-hidden="true">▾</span>
          </button>
        )}

        {!hideStats && !isIdle && effectiveHeaderVisibility.sessionWords && (
          <div
            onClick={onGoalClick}
            className={cn("flex-1 min-h-[44px] justify-center flex flex-col gap-px cursor-pointer [-webkit-tap-highlight-color:transparent]", "min-w-11 overflow-hidden")}
            role="button"
            tabIndex={0}
            aria-label={t('writing_mode_words')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onGoalClick?.(); } }}
          >
            <span className="text-[17px] font-medium text-[var(--text-main)] leading-none">
              {sessionWords}
              {showWordGoal && (
                <span className="text-[11px] text-[var(--text-muted)] ml-0.5">
                  /{wordGoal}
                </span>
              )}
            </span>
            {showWordGoal && (
              <DottedProgress
                pct={sessionWords / wordGoal}
                color={getWpmHex(wpm)}
              />
            )}
            <span className={cn("text-[9px] text-[var(--text-subtle)] uppercase tracking-[0.06em]", showWordGoal ? "mt-px" : "mt-[3px]", "max-[399px]:hidden")}>
              {t('header_sessionWords')}
            </span>
          </div>
        )}

        {!hideStats && !isIdle && effectiveHeaderVisibility.sessionTime && (
          <div
            onClick={onGoalClick}
            className={cn("flex-1 min-h-[44px] justify-center flex flex-col gap-px cursor-pointer [-webkit-tap-highlight-color:transparent]", "min-w-11 overflow-hidden", "max-[379px]:hidden")}
            role="button"
            tabIndex={0}
            aria-label={t('writing_mode_timer')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onGoalClick?.(); } }}
          >
            <span className="text-[17px] font-medium text-[var(--text-main)] leading-none font-mono tabular-nums">
              {formatTime(cellTime)}
            </span>
            <span className="text-[9px] text-[var(--text-subtle)] uppercase tracking-[0.06em] mt-0.5 max-[399px]:hidden">
              {showCountdown
                ? `${t('goal_time_of')} ${Math.round(timerDuration / 60)}${t('goal_time_min')}`
                : t('header_time')}
            </span>
          </div>
        )}

        {!hideStats && !isIdle && effectiveHeaderVisibility.wpm && (
          <div className={cn("flex-1 flex flex-col gap-px", "min-w-0 overflow-hidden", "max-[429px]:hidden")}>
            <div className="flex items-center gap-1.25 leading-none">
              <div
                className="w-[7px] h-[7px] rounded-full shrink-0 transition-[background,box-shadow] duration-500"
                style={wpmDotStyle}
              />
              <span className="text-[17px] font-medium text-[var(--text-main)]">
                {wpm}
              </span>
            </div>
            <MiniSpark history={wpmHistory} color={getWpmHex(wpm)} />
            <span className="text-[9px] text-[var(--text-subtle)] uppercase tracking-[0.06em] mt-0.5 max-[399px]:hidden">
              {t('header_wpm')}
            </span>
          </div>
        )}
      </div>

      {!hideStats && <div className={cn("w-px h-9 bg-[var(--border-light)] mx-3", "max-[359px]:mx-1")} />}

      <div className="flex gap-1.5 shrink-0" >
        {/* MC-1: переключатель ИИ живёт только во время сессии — в idle он был
            четвёртой целью в панели до первой буквы. */}
        {!isIdle && (
          <AIToggleButton
            active={aiPanelOpen}
            onClick={() => setAiPanelOpen(!aiPanelOpen)}
            className="w-11 h-11 rounded-xl shrink-0"
          />
        )}

        {hasSupport && (
          <div className="relative">
            <IconButton
              onClick={toggle}
              label={dictationMicLabel(isListening, isVaultActive, aiNoticeRemaining !== null, t)}
              className={cn(
                "w-11 h-11 rounded-xl flex items-center justify-center cursor-pointer border shrink-0",
                isListening
                  ? "border-accent-danger bg-accent-danger/10 text-accent-danger animate-pulse"
                  : isVaultActive
                  ? "border-accent-warning/50 bg-accent-warning/5 text-accent-warning"
                  : "border-[var(--border-light)] bg-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]"
              )}
              icon={isListening ? <MicOff size={16} /> : <Mic size={16} />}
            />
            {aiNoticeRemaining !== null && !isListening && (
              <Sparkles
                size={10}
                className="absolute -top-1 -right-1 text-accent-warning pointer-events-none"
                aria-hidden="true"
              />
            )}
            {isVaultActive && !isListening && (
              <span
                className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-accent-warning pointer-events-none"
                title={t('voice_vault_badge')}
              />
            )}
          </div>
        )}

        {/* MC-1: в idle кнопки запуска нет — сессию начинает первая буква (MR-6).
            Переключатель паузы остаётся только для начатой сессии. */}
        {!isIdle && (
          <IconButton
            onClick={isRunning ? onPause : onPlay}
            label={isRunning ? t('pause') : t('play')}
            className={cn(
              "w-11 h-11 rounded-xl flex items-center justify-center cursor-pointer border shrink-0",
              // MC-1 §5: залатана иконка воспроизведения — `var(--flow-pulse-color,…)`
              // с tailwind-фолбэком внутри var() не применялся, и фон со значком
              // были одного цвета (#A583E8 в тёмном, #8B7E74 в светлом). Теперь
              // значок рисуется цветом фона на сплошной подложке.
              isRunning ? "border-[var(--border-light)] bg-[var(--surface-card)] text-[var(--text-main)] opacity-70" : "border-[var(--flow-pulse-color)] bg-[var(--flow-pulse-color)] text-[var(--bg-base)]"
            )}
            icon={isRunning ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="7" y="5" width="4" height="14" rx="1"/>
                <rect x="13" y="5" width="4" height="14" rx="1"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
              </svg>
            )}
          />
        )}

        {/* MC-1: «Готово» — слово в пилюле 44 px вместо иконки квадрата. */}
        <button
          type="button"
          onClick={onStop}
          disabled={isIdle}
          aria-label={t('writing_done')}
          className={cn(
            "min-h-11 shrink-0 rounded-full px-4 clickable-target-expansion text-[14px] font-semibold transition-opacity",
            isIdle ? "cursor-default opacity-45" : "cursor-pointer opacity-100"
          )}
          style={{ background: 'var(--text-main)', color: 'var(--bg-base)' }}
        >
          {t('writing_done')}
        </button>

        {onNew && sessionWords > 0 && (
          <IconButton
            onClick={onNew}
            label={t('topbar_new')}
            className="w-11 h-11 rounded-xl border border-[var(--border-light)] bg-transparent text-[var(--text-muted)] flex items-center justify-center cursor-pointer ml-1 shrink-0"
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            }
          />
        )}
      </div>

      <AnimatePresence>
        {showExitConfirm && (
          <div className="fixed inset-0 z-[var(--z-sheet)] flex items-end justify-center bg-black/60 backdrop-blur-sm">
            <div className="absolute inset-0" onClick={() => setShowExitConfirm(false)} />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="relative z-10 w-full max-w-lg bg-surface-card border-t border-white/[0.06] rounded-t-[28px] overflow-hidden flex flex-col p-6 space-y-6 shadow-[0_-8px_32px_rgba(0,0,0,0.4)] pb-[calc(env(safe-area-inset-bottom,16px)+16px)]"
            >
              <div className="flex justify-center">
                <div className="w-12 h-1.5 rounded-full bg-white/10" />
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
