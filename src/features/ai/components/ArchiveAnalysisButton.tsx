import { useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { Button } from '../../../shared/components/Button';
import { ModalShell } from '../../../shared/components/ModalShell';
import { useToast } from '../../../shared/components/Toast';
import { getCurrentUser } from '../../../core/auth';
import { hasIndexingConsent } from '../../../core/ai/indexingConsent';
import { NoteAnalysisService, type BatchResult, type PendingSurvey } from '../services/NoteAnalysisService';
import { reportError } from '../../../shared/errors/reportError';

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
  errors: 'три отказа подряд — похоже, связь или сервис недоступны',
};

export function ArchiveAnalysisButton() {
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
        showToast(
          `Разобрано ${result.analyzed}, проход остановлен: ${STOP_MESSAGES[result.stopped]}`,
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
              ? 'Жду сброса ограничения…'
              : `Разбираю ${progress.done} из ${progress.total}…`}
          </>
        ) : counting ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            Считаю, сколько ждёт…
          </>
        ) : (
          <>
            <Sparkles size={16} />
            Разобрать заметки
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
            Разобрать заметки
          </div>

          {nothingToDo ? (
            <p className="text-xs text-text-main/60 mb-4">
              Разбирать нечего. На устройстве заметок: {survey.totalDocuments}, из них
              разобраны {survey.alreadyAnalyzed}
              {survey.noContent > 0 && `, без текста на устройстве ${survey.noContent}`}
              {survey.tooShort > 0 && `, слишком коротких ${survey.tooShort}`}
              {survey.excluded > 0 && `, исключено из ИИ ${survey.excluded}`}.
            </p>
          ) : (
            <>
              <p className="text-xs text-text-main/60 mb-3">
                Ждут разбора: <span className="font-mono text-text-main">{survey.ids.length}</span>.
                Текст этих заметок уйдёт поставщику ИИ — по одной, по вашему нажатию.
              </p>

              <div className="space-y-1 mb-3 text-xs text-text-main/50">
                <div className="flex items-center justify-between">
                  <span>Заметок на этом устройстве</span>
                  <span className="font-mono">{survey.totalDocuments}</span>
                </div>
                {survey.alreadyAnalyzed > 0 && (
                  <div className="flex items-center justify-between">
                    <span>Уже разобраны</span>
                    <span className="font-mono">{survey.alreadyAnalyzed}</span>
                  </div>
                )}
                {survey.noContent > 0 && (
                  <div className="flex items-center justify-between">
                    <span>Текста нет на устройстве</span>
                    <span className="font-mono">{survey.noContent}</span>
                  </div>
                )}
                {survey.tooShort > 0 && (
                  <div className="flex items-center justify-between">
                    <span>Слишком короткие</span>
                    <span className="font-mono">{survey.tooShort}</span>
                  </div>
                )}
                {survey.excluded > 0 && (
                  <div className="flex items-center justify-between">
                    <span>Исключены из ИИ</span>
                    <span className="font-mono">{survey.excluded}</span>
                  </div>
                )}
              </div>

              <p className="text-xs text-text-main/60 mb-3">
                Проход остановится сам, когда упрётся в дневной лимит, и продолжится
                со следующего нажатия — уже разобранное второй раз не отправляется.
              </p>

              {!indexingOn && (
                <p className="text-xs text-accent-danger mb-4">
                  Поиск по смыслу выключен в настройках, поэтому векторы считаться не будут:
                  разбор появится, а в поиске по смыслу эти заметки не найдутся.
                </p>
              )}
            </>
          )}

          <div className="flex gap-2">
            {!nothingToDo && (
              <Button
                onClick={() => void start()}
                className="flex-1 py-2 rounded-xl bg-brand-soft text-white text-sm font-semibold hover:bg-brand-soft-hover transition-colors"
              >
                Разобрать
              </Button>
            )}
            <Button
              onClick={() => setSurvey(null)}
              className="flex-1 py-2 rounded-xl border border-border-subtle text-text-main/60 text-sm hover:text-text-main transition-colors"
            >
              {nothingToDo ? 'Понятно' : 'Отмена'}
            </Button>
          </div>
        </ModalShell>
      )}
    </>
  );
}
