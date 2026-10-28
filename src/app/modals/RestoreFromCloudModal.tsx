import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStatus } from '../../features/auth/hooks/useAuthStatus';
import { CloudSyncService } from '../../core/services/CloudSyncService';
import { emitDomainEvent } from '../../core/events/domainEvents';
import { STORAGE_KEYS } from '../../shared/constants/storageKeys';
import { setCloudSyncEnabled } from '../../core/sync/cloudSyncEnabled';
import { useLanguage } from '../../shared/i18n';
import { ModalShell } from '../../shared/components/ModalShell';
import { Button } from '../../shared/components/Button';
import { DocumentService } from '../../core/services/DocumentService';
import { isUnreadableCloudList } from '../../core/services/cloudListPartial';
import { LocalStorageService } from '../../core/services/LocalStorageService';
import { setRestoreDismissed } from '../../core/sync/useEmptyDeviceDetection';
import { CloudDownload, CheckCircle, AlertTriangle } from 'lucide-react';

export interface RestoreFromCloudModalProps {
  onRestoreAIData?: ((userId: string) => Promise<{ summaries: number; embeddings?: number; localStoreRecords: number; failed: number; oversized?: number }>) | undefined;
  open: boolean;
  onClose: () => void;
  initialLocalCount?: number | undefined;
  initialCloudCount?: number | undefined;
}

type RestoreStep = 'idle' | 'restoring' | 'completed' | 'failed';

interface RestoreProgressState {
  currentStage: string;
  notesCurrent: number;
  notesTotal: number;
  summariesCount: number;
  embeddingsCount: number;
  localStoreCount: number;
  percent: number;
}

interface RestoreSummaryReport {
  restoredNotes: number;
  restoredSummaries: number;
  restoredEmbeddings: number;
  restoredAIStoreRecords: number;
  failedCount: number;
  oversizedCount?: number;
}

export function RestoreFromCloudModal({
  open,
  onClose,
  initialLocalCount,
  initialCloudCount,
  onRestoreAIData,
}: RestoreFromCloudModalProps) {
  const { user } = useAuthStatus();
  const { t } = useLanguage();

  const [step, setStep] = useState<RestoreStep>('idle');
  const [includeNotes, setIncludeNotes] = useState(true);
  const [includeSummaries, setIncludeSummaries] = useState(true);
  const [includeAIData, setIncludeAIData] = useState(true);

  const [localCount, setLocalCount] = useState(initialLocalCount ?? 0);
  const [cloudCount, setCloudCount] = useState(initialCloudCount ?? 0);
  const [loadingCounts, setLoadingCounts] = useState(() => (
    open && Boolean(user) && (initialCloudCount === undefined || initialLocalCount === undefined)
  ));
  const [countsError, setCountsError] = useState<string | null>(null);
  // R-2: сколько облачных рядов не прочиталось — счётчик показывает прочитанное с пометкой.
  const [cloudUnreadable, setCloudUnreadable] = useState(0);
  // Битый ряд не делает список пустым: прочитанные считаем, нечитаемые — отдельно.
  const readCloudDocs = useCallback(async (uid: string) => {
    try {
      return { docs: await DocumentService.getUserDocuments(uid), unreadable: 0 };
    } catch (e) {
      if (isUnreadableCloudList(e)) return { docs: e.docs, unreadable: e.ids.length };
      throw e;
    }
  }, []);
  // Инициализатор useState отработал бы одно открытие: в настройках окно не
  // размонтируют, и второе открытие показывало прежние числа, пока висит новый
  // запрос. Это «состояние из пропсов» во время рендера — паттерн React, а не
  // эффект: каскада рендеров нет и храповик set-state-in-effect не растёт.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && (initialCloudCount === undefined || initialLocalCount === undefined)) {
      setLoadingCounts(Boolean(user));
      setCountsError(null);
    }
  }
  const [progress, setProgress] = useState<RestoreProgressState>({
    currentStage: '',
    notesCurrent: 0,
    notesTotal: 0,
    summariesCount: 0,
    embeddingsCount: 0,
    localStoreCount: 0,
    percent: 0,
  });

  const [report, setReport] = useState<RestoreSummaryReport | null>(null);
  // Упало ли восстановление, или дошло до конца и не нашло, что вернуть.
  const [threw, setThrew] = useState(false);
  const [autoSyncPromptAnswered, setAutoSyncPromptAnswered] = useState(false);

  const loadCounts = useCallback(() => {
    if (!user) return;
    setLoadingCounts(true);
    setCountsError(null);
    void Promise.all([
      LocalStorageService.getDocumentsByOwner(user.uid),
      readCloudDocs(user.uid),
    ]).then(([localDocs, cloud]) => {
      setLocalCount(localDocs.length);
      setCloudCount(cloud.docs.length);
      setCloudUnreadable(cloud.unreadable);
      setLoadingCounts(false);
    }).catch(() => {
      setLoadingCounts(false);
      setCountsError(t('restore_cloud_counts_error'));
    });
  }, [user, t, readCloudDocs]);

  useEffect(() => {
    let active = true;
    if (open && user && (initialCloudCount === undefined || initialLocalCount === undefined)) {
      void Promise.all([
        LocalStorageService.getDocumentsByOwner(user.uid),
        readCloudDocs(user.uid),
      ]).then(([localDocs, cloud]) => {
        if (active) {
          setLocalCount(localDocs.length);
          setCloudCount(cloud.docs.length);
          setCloudUnreadable(cloud.unreadable);
          setLoadingCounts(false);
        }
      }).catch(() => {
        if (active) {
          setLoadingCounts(false);
          setCountsError(t('restore_cloud_counts_error'));
        }
      });
    }
    return () => {
      active = false;
    };
  }, [open, user, initialCloudCount, initialLocalCount, t, readCloudDocs]);

  const handleStartRestore = async () => {
    if (!user) return;
    setStep('restoring');

    const resultSummary: RestoreSummaryReport = {
      restoredNotes: 0,
      restoredSummaries: 0,
      restoredEmbeddings: 0,
      restoredAIStoreRecords: 0,
      failedCount: 0,
      oversizedCount: 0,
    };

    try {
      // Step 1: Notes & Versions
      if (includeNotes) {
        setProgress({
          currentStage: t('restore_cloud_stage_notes'),
          notesCurrent: 0,
          notesTotal: cloudCount,
          summariesCount: 0,
          embeddingsCount: 0,
          localStoreCount: 0,
          percent: 10,
        });

        const noteRes = await CloudSyncService.restoreMissingDocuments(user.uid, {
          force: true,
          onProgress: (current, total) => {
            setProgress(prev => ({
              ...prev,
              currentStage: t('restore_cloud_stage_notes_progress', { current, total }),
              notesCurrent: current,
              notesTotal: total,
              percent: Math.min(60, 10 + Math.round((current / (total || 1)) * 50)),
            }));
          },
        });
        resultSummary.restoredNotes = noteRes.restored;
      }

      // Step 2: AI Summaries, Embeddings & Local Store Records (13 stores)
      let aiDataMeasured = false;
      if (includeSummaries || includeAIData) {
        setProgress(prev => ({
          ...prev,
          currentStage: t('restore_cloud_stage_derivatives'),
          percent: 70,
        }));

        if (onRestoreAIData) {
          aiDataMeasured = true;
          const aiRes = await onRestoreAIData(user.uid);
          resultSummary.restoredSummaries = aiRes.summaries;
          resultSummary.restoredEmbeddings = (aiRes as { embeddings?: number }).embeddings ?? 0;
          resultSummary.restoredAIStoreRecords = aiRes.localStoreRecords;
          resultSummary.failedCount += aiRes.failed;
          resultSummary.oversizedCount = (aiRes as { oversized?: number }).oversized ?? 0;
        } else {
          emitDomainEvent({ type: 'sync.restoredFromCloud', userId: user.uid });
        }

        setProgress(prev => ({
          ...prev,
          currentStage: t('restore_cloud_stage_linking'),
          summariesCount: resultSummary.restoredSummaries,
          embeddingsCount: resultSummary.restoredEmbeddings,
          localStoreCount: resultSummary.restoredAIStoreRecords,
          percent: 90,
        }));
      }

      setProgress(prev => ({
        ...prev,
        currentStage: t('restore_cloud_stage_done'),
        percent: 100,
      }));

      setReport(resultSummary);
      // AUD-12 / AG-RESTORE-3: Восстановившее ноль заметок — не «завершённое» восстановление,
      // НО если были восстановлены производные данные ИИ (когда заметки уже есть на устройстве),
      // это успешное восстановление. Неизмеренные стадии не считаются за ноль.
      const hasRestoredData = resultSummary.restoredNotes > 0
        || (aiDataMeasured && (
          resultSummary.restoredSummaries > 0
          || resultSummary.restoredEmbeddings > 0
          || resultSummary.restoredAIStoreRecords > 0
        ));

      if (!hasRestoredData) {
        // Проход дошёл до конца и не вернул ничего — это не то же самое, что
        // падение. Сказать «прервано ошибкой» там, где ошибки не было, —
        // такая же ложь наоборот, как и «завершено» после падения.
        setThrew(false);
        setStep('failed');
      } else {
        setRestoreDismissed(user.uid, true);
        setStep('completed');
      }
    } catch {
      // AUD-12: исключение больше не рисует «завершено». Говорим, что не вышло,
      // и сколько успело вернуться до падения.
      setReport(resultSummary);
      setThrew(true);
      setStep('failed');
    }
  };

  const handleEnableAutoSync = () => {
    if (user) {
      setCloudSyncEnabled(user.uid, true);
    }
    setAutoSyncPromptAnswered(true);
  };

  const handleSkipAutoSync = () => {
    setAutoSyncPromptAnswered(true);
  };

  const handleDismiss = () => {
    if (user) {
      setRestoreDismissed(user.uid, true);
    }
    onClose();
  };

  const isAutoSyncAlreadyEnabled = user ? localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(user.uid)) === 'true' : false;

  return (
    <ModalShell
      open={open}
      onClose={() => { if (step !== 'restoring') onClose(); }}
      labelId="restore-cloud-title"
      // A-9b: ModalWrapper рисовал карточку сам, ModalShell — нет.
      className="max-w-md bg-surface-card border border-border-subtle rounded-2xl p-6 shadow-lg"
    >
      <div className="space-y-4 p-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-soft/10 text-brand-soft flex items-center justify-center border border-brand-soft/20 shrink-0">
            <CloudDownload className="w-5 h-5" />
          </div>
          <div>
            <h2 id="restore-cloud-title" className="text-base font-semibold text-text-main">
              {step === 'completed'
                ? t('restore_cloud_title_completed')
                : step === 'failed'
                  ? (threw ? t('restore_cloud_title_failed') : t('restore_cloud_title_empty'))
                  : t('restore_cloud_title_loading')}
            </h2>
          </div>
        </div>

        {step === 'idle' && (
          <div className="space-y-4">
            <p className="text-xs text-text-main/70 leading-relaxed">
              {loadingCounts
                ? (localCount === 0
                  ? t('restore_cloud_desc_loading_zero')
                  : t('restore_cloud_desc_loading_nonzero'))
                : countsError
                  ? (localCount === 0
                    ? t('restore_cloud_desc_error_zero')
                    : t('restore_cloud_desc_error_nonzero', { localCount }))
                  : (localCount === 0
                    ? t('restore_cloud_desc_ready_zero', { cloudCount })
                    : t('restore_cloud_desc_ready_nonzero', { localCount, cloudCount }))}
            </p>

            {!countsError && cloudUnreadable > 0 && (
              <div className="p-2.5 rounded-xl bg-accent-warning/10 border border-accent-warning/20 text-xs text-accent-warning" data-testid="restore-cloud-partial">
                {t('restore_cloud_counts_partial', { count: cloudUnreadable })}
              </div>
            )}

            {countsError && (
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-accent-danger/10 border border-accent-danger/20 text-xs text-accent-danger">
                <span>{countsError}</span>
                <button
                  type="button"
                  onClick={loadCounts}
                  className="font-medium underline hover:no-underline ml-2 shrink-0 cursor-pointer"
                >
                  {t('restore_cloud_counts_retry')}
                </button>
              </div>
            )}

            <div className="space-y-2.5 pt-2 border-t border-border-subtle">
              <label className="flex items-start gap-3 cursor-pointer group p-2 rounded-lg hover:bg-surface-base/50">
                <input
                  type="checkbox"
                  checked={includeNotes}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIncludeNotes(e.target.checked)}
                  className="mt-0.5 rounded border-border-subtle text-accent"
                />
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-text-main group-hover:text-accent transition-colors">
                    {t('restore_cloud_opt_notes_title')}
                  </div>
                  <div className="text-[11px] text-text-main/60">
                    {t('restore_cloud_opt_notes_desc', { count: loadingCounts ? '…' : (countsError ? '—' : cloudCount) })}
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer group p-2 rounded-lg hover:bg-surface-base/50">
                <input
                  type="checkbox"
                  checked={includeSummaries}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIncludeSummaries(e.target.checked)}
                  className="mt-0.5 rounded border-border-subtle text-accent"
                />
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-text-main group-hover:text-accent transition-colors">
                    {t('restore_cloud_opt_ai_title')}
                  </div>
                  <div className="text-[11px] text-text-main/60">
                    {t('restore_cloud_opt_ai_desc')}
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer group p-2 rounded-lg hover:bg-surface-base/50">
                <input
                  type="checkbox"
                  checked={includeAIData}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIncludeAIData(e.target.checked)}
                  className="mt-0.5 rounded border-border-subtle text-accent"
                />
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-text-main group-hover:text-accent transition-colors">
                    {t('restore_cloud_opt_profile_title')}
                  </div>
                  <div className="text-[11px] text-text-main/60">
                    {t('restore_cloud_opt_profile_desc')}
                  </div>
                </div>
              </label>
            </div>

            <div className="pt-3 border-t border-border-subtle flex items-center justify-between">
              <Button onClick={handleDismiss} className="px-3 py-1.5 text-xs text-text-main/60 hover:text-text-main">
                {t('restore_cloud_btn_not_now')}
              </Button>
              <Button
                onClick={() => void handleStartRestore()}
                disabled={!includeNotes && !includeSummaries && !includeAIData}
                className="px-4 py-2 text-xs font-semibold bg-brand-soft text-surface-base hover:opacity-90 flex items-center gap-1.5"
              >
                <CloudDownload className="w-4 h-4" />
                {t('restore_cloud_btn_start')}
              </Button>
            </div>
          </div>
        )}

        {step === 'restoring' && (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-text-main/70">
                <span>{progress.currentStage}</span>
                <span className="font-semibold">{progress.percent}%</span>
              </div>
              <div className="w-full h-2 bg-surface-base rounded-full overflow-hidden border border-border-subtle">
                <div
                  className="h-full bg-accent transition-all duration-300 rounded-full"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>

            <div className="p-3 bg-surface-base rounded-xl border border-border-subtle text-xs space-y-1.5 text-text-main/60">
              {progress.notesTotal > 0 && (
                <div className="flex justify-between">
                  <span>{t('restore_cloud_prog_notes')}</span>
                  <span className="text-text-main font-medium">{progress.notesCurrent} / {progress.notesTotal}</span>
                </div>
              )}
              {progress.summariesCount > 0 && (
                <div className="flex justify-between">
                  <span>{t('restore_cloud_prog_summaries')}</span>
                  <span className="text-text-main font-medium">{progress.summariesCount}</span>
                </div>
              )}
              {progress.embeddingsCount > 0 && (
                <div className="flex justify-between">
                  <span>{t('restore_cloud_prog_embeddings')}</span>
                  <span className="text-text-main font-medium">{progress.embeddingsCount}</span>
                </div>
              )}
              {progress.localStoreCount > 0 && (
                <div className="flex justify-between">
                  <span>{t('restore_cloud_prog_ai_records')}</span>
                  <span className="text-text-main font-medium">{progress.localStoreCount}</span>
                </div>
              )}
            </div>

            <p className="text-[11px] text-text-main/50 text-center italic">
              {t('restore_cloud_prog_keep_open')}
            </p>
          </div>
        )}

        {step === 'failed' && (
          <div className="space-y-4">
            <div className="p-3.5 bg-accent-danger/10 border border-accent-danger/20 rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-accent-danger">
                <AlertTriangle className="w-4 h-4 text-accent-danger" />
                {threw
                  ? t('restore_cloud_fail_threw')
                  : t('restore_cloud_fail_empty')}
              </div>
              {/* Частичный успех — числами: что успело вернуться до падения. */}
              {(Boolean(report?.restoredNotes) || Boolean(report?.restoredSummaries) || Boolean(report?.restoredEmbeddings) || Boolean(report?.restoredAIStoreRecords) || Boolean(report?.oversizedCount)) && (
                <div className="text-[11px] text-text-main/70 space-y-1 pl-6">
                  {Boolean(report?.restoredNotes) && <div>{t('restore_cloud_stat_notes')} <strong className="text-text-main">{report?.restoredNotes}</strong></div>}
                  {Boolean(report?.restoredSummaries) && <div>{t('restore_cloud_stat_summaries')} <strong className="text-text-main">{report?.restoredSummaries}</strong></div>}
                  {Boolean(report?.restoredEmbeddings) && <div>{t('restore_cloud_stat_embeddings')} <strong className="text-text-main">{report?.restoredEmbeddings}</strong></div>}
                  {Boolean(report?.restoredAIStoreRecords) && <div>{t('restore_cloud_stat_ai_records')} <strong className="text-text-main">{report?.restoredAIStoreRecords}</strong></div>}
                  {Boolean(report?.oversizedCount) && <div>{t('restore_cloud_stat_oversized')} <strong className="text-accent-warning">{report?.oversizedCount}</strong></div>}
                </div>
              )}
            </div>

            <div className="pt-2 flex items-center justify-end gap-2">
              <Button onClick={handleDismiss} className="px-3 py-1.5 text-xs text-text-main/60 hover:text-text-main">
                {t('restore_cloud_btn_not_now')}
              </Button>
              <Button
                onClick={() => void handleStartRestore()}
                className="px-4 py-2 text-xs font-semibold bg-brand-soft text-surface-base hover:opacity-90"
              >
                {t('restore_cloud_btn_retry')}
              </Button>
            </div>
          </div>
        )}

        {step === 'completed' && (
          <div className="space-y-4">
            <div className="p-3.5 bg-accent/10 border border-accent/20 rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-accent">
                <CheckCircle className="w-4 h-4 text-accent" />
                {t('restore_cloud_success_title')}
              </div>
              <div className="text-[11px] text-text-main/70 space-y-1 pl-6">
                <div>{t('restore_cloud_stat_notes')} <strong className="text-text-main">{report?.restoredNotes ?? 0}</strong></div>
                <div>{t('restore_cloud_stat_summaries')} <strong className="text-text-main">{report?.restoredSummaries ?? 0}</strong></div>
                {Boolean(report?.restoredEmbeddings) && (
                  <div>{t('restore_cloud_success_embeddings')} <strong className="text-text-main">{report?.restoredEmbeddings}</strong></div>
                )}
                <div>{t('restore_cloud_success_ai_records')} <strong className="text-text-main">{report?.restoredAIStoreRecords ?? 0}</strong></div>
                {Boolean(report?.failedCount) && (
                  <div className="text-accent-warning flex items-center gap-1 mt-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {t('restore_cloud_failed_skipped')} {report?.failedCount}
                  </div>
                )}
                {Boolean(report?.oversizedCount) && (
                  <div className="text-accent-warning flex items-center gap-1 mt-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {t('restore_cloud_oversized_skipped')} {report?.oversizedCount}
                  </div>
                )}
              </div>
            </div>

            {!isAutoSyncAlreadyEnabled && !autoSyncPromptAnswered && (
              <div className="p-3 bg-surface-base border border-border-subtle rounded-xl space-y-2">
                <div className="text-xs font-medium text-text-main">
                  {t('restore_cloud_autosync_title')}
                </div>
                <div className="text-[11px] text-text-main/60">
                  {t('restore_cloud_autosync_desc')}
                </div>
                <div className="flex gap-2 pt-1">
                  <Button onClick={handleEnableAutoSync} className="px-3 py-1.5 text-xs bg-brand-soft text-surface-base hover:opacity-90">
                    {t('restore_cloud_autosync_enable')}
                  </Button>
                  <Button onClick={handleSkipAutoSync} className="px-3 py-1.5 text-xs text-text-main/60 hover:text-text-main">
                    {t('restore_cloud_autosync_manual')}
                  </Button>
                </div>
              </div>
            )}

            <div className="pt-2 flex justify-end">
              <Button onClick={onClose} className="px-4 py-2 text-xs font-semibold bg-surface-base border border-border-subtle text-text-main hover:bg-surface-card">
                {t('common_done')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
