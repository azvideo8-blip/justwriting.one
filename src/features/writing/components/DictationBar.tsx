import { useEffect, useState } from 'react';
import { Loader2, MicOff, Square, X } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n';
import { useDictation } from '../hooks/useDictation';
import { cn } from '../../../core/utils/utils';

// D-4: панель записи. Один экземпляр на экран (его монтирует chrome редактора),
// кнопки в трёх тулбарах только включают и выключают сессию.

const MIN_BAR_PCT = 12;

export type DictationPhase = 'recording' | 'processing';

export interface DictationBarProps {
  liveText: string;
  interimText: string;
  /** Текущий уровень — для статичной полосы при prefers-reduced-motion. */
  level: number;
  /** Кольцевая история уровней (32 значения) — сама волна. */
  levels: number[];
  levelFailed: boolean;
  phase: DictationPhase;
  seconds: number;
  /** Число оставшихся дневных запросов, если запись пойдёт через ИИ. null — ИИ не
   *  используется: строки про запрос не показывать. */
  aiNoticeRemaining: number | null;
  onStop: () => void;
  onCancel: () => void;
}

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function DictationBar({
  liveText, interimText, level, levels, levelFailed, phase, seconds, aiNoticeRemaining, onStop, onCancel,
}: DictationBarProps) {
  const { t } = useLanguage();
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);


  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const processing = phase === 'processing';
  const heights = levels;

  return (
    <div
      className="flex items-center gap-3 px-3 py-2 rounded-xl border border-border-subtle bg-surface-card"
      data-dictation-bar
      data-phase={phase}
    >
      {processing ? (
        <div className="flex items-center gap-2 text-text-main/70" data-dictation-spinner>
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          <span className="text-xs">{t('voice_processing')}</span>
        </div>
      ) : levelFailed || prefersReducedMotion ? (
        // Уровень недоступен (iOS Safari, часть Android) или анимация выключена:
        // одна точка/полоса вместо волны. Диктовка при этом работает как обычно.
        <div className="flex items-center gap-2" data-dictation-static>
          <span
            className={cn('w-2.5 h-2.5 rounded-full', prefersReducedMotion && !levelFailed ? 'bg-accent-danger' : 'bg-accent-danger animate-pulse')}
            aria-hidden="true"
          />
          {prefersReducedMotion && !levelFailed && (
            <span
              className="h-1 w-24 rounded-full bg-accent-danger/40"
              style={{ width: `${MIN_BAR_PCT + Math.round(level * (100 - MIN_BAR_PCT))}%` }}
              aria-hidden="true"
            />
          )}
        </div>
      ) : (
        <div className="flex items-end gap-[2px] h-6" data-dictation-wave aria-hidden="true">
          {heights.map((h, i) => (
            <span
              key={i}
              className="w-[3px] rounded-full bg-text-main/60"
              style={{ height: `${MIN_BAR_PCT + Math.round(h * (100 - MIN_BAR_PCT))}%` }}
            />
          ))}
        </div>
      )}

      <div className="flex-1 min-w-0 text-sm text-text-main" aria-live="polite" data-dictation-words>
        {aiNoticeRemaining !== null && !processing && (
          <div className="text-[11px] text-text-main/60" data-dictation-ai-notice>
            {t('voice_ai_request_notice', { remaining: aiNoticeRemaining })}
          </div>
        )}
        <div className="truncate max-h-10 overflow-hidden">
          {liveText}
          {interimText && <span className="text-text-main/45"> {interimText}</span>}
        </div>
      </div>

      <span className="tabular-nums text-xs text-text-main/60" data-dictation-timer>{formatSeconds(seconds)}</span>

      <button
        type="button"
        onClick={onStop}
        disabled={processing}
        aria-label={t('voice_stop_dictation')}
        title={t('voice_stop_dictation')}
        className={cn(
          'h-11 min-w-11 px-3 flex items-center justify-center gap-1.5 rounded-lg clickable-target-expansion text-sm',
          processing ? 'text-text-main/30' : 'bg-accent-danger/10 text-accent-danger hover:bg-accent-danger/20',
        )}
      >
        <Square size={14} aria-hidden="true" />
        <span>{t('voice_stop')}</span>
      </button>

      <button
        type="button"
        onClick={onCancel}
        disabled={processing}
        aria-label={t('voice_cancel')}
        title={t('voice_cancel')}
        className={cn(
          'h-11 w-11 flex items-center justify-center rounded-lg clickable-target-expansion',
          processing ? 'text-text-main/30' : 'text-text-main/60 hover:text-text-main hover:bg-text-main/5',
        )}
      >
        {processing ? <MicOff size={14} aria-hidden="true" /> : <X size={16} aria-hidden="true" />}
      </button>
    </div>
  );
}

/**
 * Единственная точка, где панель записи монтируется: chrome редактора. Кнопки в
 * тулбарах только отдают команды этому экземпляру (см. useDictation), поэтому
 * волна и живые слова всегда ровно одни.
 */
export function DictationChrome() {
  const d = useDictation();
  if (!d.hasSupport || d.phase === 'idle') return null;
  return (
    <div className="px-3 py-2">
      <DictationBar
        liveText={d.liveText}
        interimText={d.interimText}
        level={d.level}
        levels={d.levels}
        levelFailed={d.levelFailed}
        phase={d.phase === 'processing' ? 'processing' : 'recording'}
        seconds={d.seconds}
        aiNoticeRemaining={d.aiNoticeRemaining}
        onStop={d.stop}
        onCancel={d.cancel}
      />
    </div>
  );
}
