import { useEffect, useId, useRef, useState } from 'react';
import { Save } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { cn } from '../../../core/utils/utils';
import { useLanguage } from '../../../shared/i18n';
import { useWritingSettings } from '../../../core/settings/WritingSettingsContext';
import type { DraftErrorKind } from '../hooks/useDraftCore';

export type SaveStatusKind = 'idle' | 'saving' | 'saved' | 'cloud-stale' | 'error';

// Дискета в панели кнопок справа внизу (рядом с микрофоном и паузой) вместо слов «Сохранение… / Сохранено»: мигающие
// надписи отвлекали от письма. Иконка почти прозрачна, на сохранении плавно
// загорается фирменным фиолетовым и гаснет; время — в подсказке по наведению.
// Ошибка и «только локально» не гаснут: цветом и голосом для скринридера (DC-W4).
const LIT_MS = 900;
// Длительность CSS-перехода гашения (duration-700): пока она идёт, иконку
// снимать нельзя — иначе затухание обрывается на середине.
const FADE_OUT_MS = 700;

function formatSavedAt(language: string, at?: number) {
  return (at === undefined ? new Date() : new Date(at)).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' });
}

// T-3 (приёмка 0.10.2): время последнего настоящего перехода в «saved». Общее для
// всех копий: перемонтированная (шапка ↔ строка дзена) показывает это время, а не
// время своего монтирования, и не вспыхивает. ponytail: модульная переменная — одна
// вкладка, один редактор; станет мало, если редакторов на экране будет два.
let lastSavedAtMs: number | null = null;

export function SaveStatus({
  saveStatus,
  saveErrorKind,
  hideWhenIdle,
}: {
  saveStatus: SaveStatusKind;
  saveErrorKind?: DraftErrorKind | undefined;
  // На телефоне статус показывается только вокруг сохранения: на idle иконки в
  // строке быть не должно (MQ-4). Десктоп оставляет дискету всегда (DC-W4).
  hideWhenIdle?: boolean;
}) {
  const { t, language } = useLanguage();
  const { isZenActive } = useWritingSettings();
  const reducedMotion = useReducedMotion();
  const tipId = useId();
  const [prevStatus, setPrevStatus] = useState<SaveStatusKind>(saveStatus);
  // B-4/T-3: копия, смонтированная в «saved», знает, что заметка сохранена, и
  // показывает время последнего настоящего сохранения (или «Сохранено», если его
  // не видела) — не «Ещё не сохранялось» и не время своего монтирования.
  const [savedAt, setSavedAt] = useState<string | null>(
    () => (saveStatus === 'saved' && lastSavedAtMs !== null ? formatSavedAt(language, lastSavedAtMs) : null),
  );
  // Вспышка — только у идущей записи; перемонтирование в «saved» не мигает (T-3).
  const [lit, setLit] = useState(saveStatus === 'saving');
  // Запоминаем время настоящего перехода в «saved» (не монтирования) — для копий,
  // которые смонтируются позже. В эффекте: модульное состояние меняется вне рендера.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current && saveStatus === 'saved') lastSavedAtMs = Date.now();
    mountedRef.current = true;
  }, [saveStatus]);

  // Переход статуса ловится во время рендера, а не в эффекте (храповик
  // set-state-in-effect): время записи и вспышка нужны сразу.
  if (saveStatus !== prevStatus) {
    setPrevStatus(saveStatus);
    if (saveStatus === 'saved') {
      setSavedAt(formatSavedAt(language));
    }
    if (saveStatus === 'saving' || saveStatus === 'saved') setLit(true);
  }

  // Короткое сохранение (десятки миллисекунд) иначе мигнуло бы незаметно:
  // иконка держит свет LIT_MS после конца записи и гаснет переходом.
  useEffect(() => {
    if (!lit || saveStatus === 'saving') return;
    const timer = setTimeout(() => setLit(false), LIT_MS);
    return () => clearTimeout(timer);
  }, [lit, saveStatus]);

  const isError = saveStatus === 'error';
  const isStale = saveStatus === 'cloud-stale';
  const activeStatus = saveStatus === 'saving' || saveStatus === 'saved' || isError || isStale;
  // B-4, пункт 2: на idle в шапке телефона иконки быть не должно, но уходить в
  // скрытие можно только когда 700-мс затухание доиграло. При keep-mounted
  // (компонент смонтирован и на idle) само скрытие — это локальный признак:
  // «показывать уже нечего». Стал снова видно — снимаем скрытие во время
  // рендера (приём перехвата статуса выше); уходим в скрытие — по таймеру,
  // setState внутри колбэка, а не в теле эффекта (тот же храповик).
  const wantHide = hideWhenIdle === true && !activeStatus && !lit;
  const [hidden, setHidden] = useState(wantHide);
  if (hidden && !wantHide) setHidden(false);
  useEffect(() => {
    if (!wantHide || hidden) return;
    const timer = setTimeout(() => setHidden(true), FADE_OUT_MS);
    return () => clearTimeout(timer);
  }, [wantHide, hidden]);
  if (hidden) return null;

  const tip = isError
    ? (saveErrorKind === 'quota' ? t('editor_error_quota') : t('editor_error_save'))
    : isStale
      // N1-5: на телефоне эта пара живёт в одном слоте с обрезкой, поэтому
      // обещание досылки — здесь, в подсказке десктопа (наведения на телефоне нет).
      ? saveErrorKind === 'cloud-too-large'
        ? t('editor_cloud_too_large_hint')
        : saveErrorKind === 'cloud-refused'
          ? t('editor_cloud_refused_hint')
          : saveErrorKind === 'cloud-off'
            ? t('editor_cloud_off_hint')
          : `${t('editor_cloud_stale')}. ${t('editor_cloud_stale_hint')}`
      : saveStatus === 'saving'
        ? t('editor_saving')
        : savedAt
          ? t('editor_saved_at', { time: savedAt })
          : saveStatus === 'saved'
            ? t('editor_saved')
            : t('editor_not_saved_yet');

  return (
    <span className="group relative inline-flex pointer-events-auto">
      <span
        data-testid="save-status"
        data-lit={lit || undefined}
        tabIndex={0}
        role="img"
        aria-label={tip}
        aria-describedby={tipId}
        className={cn(
          'w-8 h-8 flex items-center justify-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand-soft/50',
          'transition-[color,opacity,filter] ease-in-out',
          reducedMotion ? 'duration-0' : 'duration-700',
          isError
            ? 'text-accent-danger opacity-100'
            : isStale
              ? 'text-accent-warning opacity-100'
              : lit
                ? 'text-brand-soft opacity-100 [filter:drop-shadow(0_0_6px_var(--brand-soft))]'
                : cn('text-text-main', isZenActive ? 'opacity-15' : 'opacity-30'),
        )}
      >
        <Save size={14} aria-hidden="true" />
      </span>
      {/* Слева от иконки, а не над ней: панель обрезает всё, что выше неё. */}
      <span
        id={tipId}
        role="tooltip"
        className="pointer-events-none absolute right-full top-1/2 -translate-y-1/2 mr-2 whitespace-nowrap rounded-md border border-border-subtle bg-surface-popup px-2 py-1 text-xs text-text-main opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {tip}
      </span>
      {/* Голосом — только то, что требует действия: каждое автосохранение
          вслух мешало бы так же, как мигающая надпись. */}
      <span className="sr-only" aria-live="polite">
        {isError || isStale ? tip : ''}
      </span>
    </span>
  );
}
