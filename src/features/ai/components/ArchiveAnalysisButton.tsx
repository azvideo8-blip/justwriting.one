import { useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { Button } from '../../../shared/components/Button';
import { ModalShell } from '../../../shared/components/ModalShell';
import { useToast } from '../../../shared/components/Toast';
import { getCurrentUser } from '../../../core/auth';
import { hasIndexingConsent } from '../../../core/ai/indexingConsent';
import { NoteAnalysisService, type BatchResult, type PendingSurvey } from '../services/NoteAnalysisService';
import { reportError } from '../../../shared/errors/reportError';
import { useLanguage } from '../../../shared/i18n';

/**
 * «Разобрать заметки» — добор корпуса для всего, что строится на разборах:
 * портрета, граней, реестра тем, дайджестов и убеждений.
 *
 * Отдельная кнопка, а не шаг «Обновить профиль», намеренно: обновление считает
 * из уже готовых разборов, а здесь наружу уходит текст самих заметок. Это
 * разные по смыслу согласия, и складывать их под одно нажатие нельзя.
 */

const STOP_MESSAGES: Record<NonNullable<BatchResult['stopped']>, string> = {
  daily: 'дневной лимит ИИ исчерпан, продолжите завтра',
  rate: 'слишком много запросов подряд, продолжите через минуту',
  global: 'общий дневной лимит приложения исчерпан',
  consent: 'нет согласия на использование ИИ',
  auth: 'сессия истекла, войдите снова',
  errors: 'три отказа подряд — похоже, связь или сервис недоступны',
};

const STOP_MESSAGES_EN: Record<NonNullable<BatchResult['stopped']>, string> = {
  daily: 'daily AI limit reached, continue tomorrow',
  rate: 'too many requests in a row, continue in a minute',
  global: 'global daily limit reached',
  consent: 'no consent to use AI',
  auth: 'session expired, sign in again',
  errors: 'three failures in a row — service or network may be unavailable',
};

export function ArchiveAnalysisButton() {
  const { t, language } = useLanguage();
  const { showToast } = useToast();
  const [survey, setSurvey] = useState<PendingSurvey | null>(null);
  const [counting, setCounting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; waiting?: boolean } | null>(null);

  const indexingOn = hasIndexingConsent(getCurrentUser()?.uid);

  const openDialog = async () => {
    setCounting(true);
    try {
      setSurvey(await NoteAnalysisService.findPending());
    } catch (e) {
      reportError(e, { action: 'archiveAnalysis_count' });
      showToast('Не удалось посчитать, сколько заметок ждёт разбора', 'error');
    } finally {
      setCounting(false);
    }
  };

  const start = async () => {
    const total = survey?.ids.length ?? 0;
    setSurvey(null);
    setProgress({ done: 0, total });
    try {
      const result = await NoteAnalysisService.analyzePending({
        onProgress: setProgress,
      });

      if (result.stopped) {
        const msg = language === 'en' ? STOP_MESSAGES_EN[result.stopped] : STOP_MESSAGES[result.stopped];
        showToast(
          language === 'en'
            ? `Analyzed ${result.analyzed}, stopped: ${msg}`
            : `Разобрано ${result.analyzed}, проход остановлен: ${msg}`,
          'error',
        );
      } else if (result.analyzed === 0) {
        showToast('Разбирать было нечего', 'success');
      } else {
        const tail = result.missingVectors > 0
          ? `, без вектора осталось ${result.missingVectors}`
          : '';
        showToast(`Разобрано заметок: ${result.analyzed}${tail}. Теперь можно обновить профиль`, 'success');
      }
    } catch (e) {
      reportError(e, { action: 'archiveAnalysis_run' }, 'warning');
      showToast('Разбор не удался', 'error');
    } finally {
      setProgress(null);
    }
  };

  const nothingToDo = survey !== null && survey.ids.length === 0;

  return (
    <>
      <Button
        onClick={() => void openDialog()}
        disabled={counting || progress !== null}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-brand-soft/10 border border-brand-soft/25 text-sm font-semibold text-brand-soft hover:bg-brand-soft/20 transition-colors disabled:opacity-60"
      >
        {progress !== null ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            {progress.waiting
              ? t('ai_archive_analysis_waiting')
              : t('ai_archive_analysis_progress', { done: String(progress.done), total: String(progress.total) })}
          </>
        ) : counting ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            {t('ai_archive_analysis_counting')}
          </>
        ) : (
          <>
            <Sparkles size={16} />
            {t('ai_archive_analysis_btn')}
          </>
        )}
      </Button>

      {survey !== null && (
        <ModalShell
          open={survey !== null}
          onClose={() => setSurvey(null)}
          labelId="archive-analysis-modal-title"
          className="w-full max-w-sm bg-surface-card border border-border-subtle rounded-2xl p-5 shadow-lg"
        >
          <div id="archive-analysis-modal-title" className="text-sm font-semibold text-text-main mb-1">
            {t('ai_archive_analysis_btn')}
          </div>

          {nothingToDo ? (
            <p className="text-xs text-text-main/60 mb-4">
              {t('ai_archive_analysis_empty_desc', {
                total: String(survey.totalDocuments),
                alreadyAnalyzed: String(survey.alreadyAnalyzed),
                tail: [
                  survey.noContent > 0 ? t('ai_archive_analysis_tail_no_content', { count: String(survey.noContent) }) : '',
                  survey.tooShort > 0 ? t('ai_archive_analysis_tail_too_short', { count: String(survey.tooShort) }) : '',
                  survey.excluded > 0 ? t('ai_archive_analysis_tail_excluded', { count: String(survey.excluded) }) : '',
                ].filter(Boolean).join(''),
              })}
            </p>
          ) : (
            <>
              <p className="text-xs text-text-main/60 mb-3">
                {t('ai_archive_analysis_pending_desc', { count: String(survey.ids.length) })}
              </p>

              <div className="space-y-1 mb-3 text-xs text-text-main/50">
                <div className="flex items-center justify-between">
                  <span>{t('ai_archive_analysis_stat_total')}</span>
                  <span className="font-mono">{survey.totalDocuments}</span>
                </div>
                {survey.alreadyAnalyzed > 0 && (
                  <div className="flex items-center justify-between">
                    <span>{t('ai_archive_analysis_stat_analyzed')}</span>
                    <span className="font-mono">{survey.alreadyAnalyzed}</span>
                  </div>
                )}
                {survey.noContent > 0 && (
                  <div className="flex items-center justify-between">
                    <span>{t('ai_archive_analysis_stat_no_content')}</span>
                    <span className="font-mono">{survey.noContent}</span>
                  </div>
                )}
                {survey.tooShort > 0 && (
                  <div className="flex items-center justify-between">
                    <span>{t('ai_archive_analysis_stat_too_short')}</span>
                    <span className="font-mono">{survey.tooShort}</span>
                  </div>
                )}
                {survey.excluded > 0 && (
                  <div className="flex items-center justify-between">
                    <span>{t('ai_archive_analysis_stat_excluded')}</span>
                    <span className="font-mono">{survey.excluded}</span>
                  </div>
                )}
              </div>

              <p className="text-xs text-text-main/60 mb-3">
                {t('ai_archive_analysis_limit_note')}
              </p>

              {!indexingOn && (
                <p className="text-xs text-accent-danger mb-4">
                  {t('ai_archive_analysis_semantic_off_warning')}
                </p>
              )}
            </>
          )}

          <div className="flex gap-2">
            {!nothingToDo && (
              <Button
                onClick={() => void start()}
                className="flex-1 py-2 rounded-xl bg-brand-soft text-surface-base text-sm font-semibold hover:bg-brand-soft-hover transition-colors"
              >
                {t('ai_archive_analysis_start')}
              </Button>
            )}
            <Button
              onClick={() => setSurvey(null)}
              className="flex-1 py-2 rounded-xl border border-border-subtle text-text-main/60 text-sm hover:text-text-main transition-colors"
            >
              {nothingToDo ? t('common_got_it') : t('common_cancel')}
            </Button>
          </div>
        </ModalShell>
      )}
    </>
  );
}
