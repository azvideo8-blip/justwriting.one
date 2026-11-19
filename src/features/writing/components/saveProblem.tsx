import type { DraftErrorKind, DraftSaveStatus } from '../hooks/useDraftCore';
import { useLanguage } from '../../../shared/i18n';

type Translate = (key: string) => string;

interface SaveProblem {
  tone: 'danger' | 'warning';
  /** Короткая подпись — строка телефона (обычная шапка и дзен). */
  label: (t: Translate) => string;
  /** Полная подсказка — значок десктопа. */
  hint: (t: Translate) => string;
}

const key = (k: string) => (t: Translate) => t(k);

/**
 * Что сказать человеку, когда сохранение не удалось или не дошло до облака.
 * Единственный источник текста на все три входа: значок десктопа (SaveStatus),
 * шапка телефона и дзен-строка (SaveProblemText). Дейлик 19.11 Н-5: дзен
 * собирал текст сам и терял причину. `switch` без default — новая причина в
 * DraftErrorKind не соберётся, пока ей здесь не дадут слова.
 */
export function saveProblem(status: DraftSaveStatus, kind: DraftErrorKind | undefined): SaveProblem | null {
  if (status === 'error') {
    const text = key(kind === 'quota' ? 'editor_error_quota' : 'editor_error_save');
    return { tone: 'danger', label: text, hint: text };
  }
  if (status !== 'cloud-stale') return null;
  const cause = kind ?? null;
  switch (cause) {
    case 'cloud-too-large': return { tone: 'warning', label: key('editor_cloud_too_large'), hint: key('editor_cloud_too_large_hint') };
    case 'cloud-refused': return { tone: 'warning', label: key('editor_cloud_refused'), hint: key('editor_cloud_refused_hint') };
    case 'cloud-off': return { tone: 'warning', label: key('editor_cloud_stale'), hint: key('editor_cloud_off_hint') };
    case 'quota':
    case 'unknown':
    case null:
      // N1-5: обещание досылки — только когда досылка действительно будет.
      return { tone: 'warning', label: key('editor_cloud_stale'), hint: t => `${t('editor_cloud_stale')}. ${t('editor_cloud_stale_hint')}` };
  }
}

/** Строка отказа сохранения на телефоне — одна на обычную шапку и дзен. */
export function SaveProblemText({ status, kind, className, testId }: { status: DraftSaveStatus; kind: DraftErrorKind | undefined; className: string; testId?: string }) {
  const { t } = useLanguage();
  const problem = saveProblem(status, kind);
  if (!problem) return null;
  return (
    <span data-testid={testId} className={className}>
      <span className={problem.tone === 'warning' ? 'text-[var(--accent-warning)]' : 'text-[var(--accent-danger)]'}>{problem.label(t)}</span>
    </span>
  );
}
