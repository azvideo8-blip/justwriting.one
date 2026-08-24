import React, { useState, useEffect } from 'react';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';
import { CloudSyncService } from '../../../core/services/CloudSyncService';
import { restoreAIDataFromCloud, reattachOrphanedAnalysis } from '../../ai/services/AIRestoreService';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { useLanguage } from '../../../shared/i18n';
import { ModalWrapper } from '../../../shared/components/ModalWrapper';
import { Button } from '../../../shared/components/Button';
import { DocumentService } from '../../../core/services/DocumentService';
import { LocalStorageService } from '../../../core/services/LocalStorageService';
import { setRestoreDismissed } from '../hooks/useEmptyDeviceDetection';
import { CloudDownload, CheckCircle, AlertTriangle } from 'lucide-react';

export interface RestoreFromCloudModalProps {
  open: boolean;
  onClose: () => void;
  initialLocalCount?: number;
  initialCloudCount?: number;
}

type RestoreStep = 'idle' | 'restoring' | 'completed' | 'failed';

interface RestoreProgressState {
  currentStage: string;
  notesCurrent: number;
  notesTotal: number;
  summariesCount: number;
  localStoreCount: number;
  percent: number;
}

interface RestoreSummaryReport {
  restoredNotes: number;
  restoredSummaries: number;
  restoredAIStoreRecords: number;
  failedCount: number;
}

export function RestoreFromCloudModal({
  open,
  onClose,
  initialLocalCount,
  initialCloudCount,
}: RestoreFromCloudModalProps) {
  const { user } = useAuthStatus();
  const { t } = useLanguage();

  const [step, setStep] = useState<RestoreStep>('idle');
  const [includeNotes, setIncludeNotes] = useState(true);
  const [includeSummaries, setIncludeSummaries] = useState(true);
  const [includeAIData, setIncludeAIData] = useState(true);

  const [localCount, setLocalCount] = useState(initialLocalCount ?? 0);
  const [cloudCount, setCloudCount] = useState(initialCloudCount ?? 0);
  const [loadingCounts, setLoadingCounts] = useState(false);

  const [progress, setProgress] = useState<RestoreProgressState>({
    currentStage: '',
    notesCurrent: 0,
    notesTotal: 0,
    summariesCount: 0,
    localStoreCount: 0,
    percent: 0,
  });

  const [report, setReport] = useState<RestoreSummaryReport | null>(null);
  const [autoSyncPromptAnswered, setAutoSyncPromptAnswered] = useState(false);

  useEffect(() => {
    let active = true;
    if (open && user && (initialCloudCount === undefined || initialLocalCount === undefined)) {
      void Promise.all([
        LocalStorageService.getGuestDocuments(user.uid),
        DocumentService.getUserDocuments(user.uid),
      ]).then(([localDocs, cloudDocs]) => {
        if (active) {
          setLocalCount(localDocs.length);
          setCloudCount(cloudDocs.length);
          setLoadingCounts(false);
        }
      }).catch(() => {
        if (active) {
          setLoadingCounts(false);
        }
      });
    }
    return () => {
      active = false;
    };
  }, [open, user, initialCloudCount, initialLocalCount]);

  const handleStartRestore = async () => {
    if (!user) return;
    setStep('restoring');

    const resultSummary: RestoreSummaryReport = {
      restoredNotes: 0,
      restoredSummaries: 0,
      restoredAIStoreRecords: 0,
      failedCount: 0,
    };

    try {
      // Step 1: Notes & Versions
      if (includeNotes) {
        setProgress({
          currentStage: 'Загрузка заметок и версий...',
          notesCurrent: 0,
          notesTotal: cloudCount,
          summariesCount: 0,
          localStoreCount: 0,
          percent: 10,
        });

        const noteRes = await CloudSyncService.restoreMissingDocuments(user.uid, {
          force: true,
          onProgress: (current, total) => {
            setProgress(prev => ({
              ...prev,
              currentStage: `Загрузка заметок (${current} из ${total})...`,
              notesCurrent: current,
              notesTotal: total,
              percent: Math.min(60, 10 + Math.round((current / (total || 1)) * 50)),
            }));
          },
        });
        resultSummary.restoredNotes = noteRes.restored;
      }

      // Step 2: AI Summaries & Local Store Records (13 stores)
      if (includeSummaries || includeAIData) {
        setProgress(prev => ({
          ...prev,
          currentStage: 'Загрузка сводок и производных данных ИИ...',
          percent: 70,
        }));

        const aiRes = await restoreAIDataFromCloud(user.uid);
        resultSummary.restoredSummaries = aiRes.summaries;
        resultSummary.restoredAIStoreRecords = aiRes.localStoreRecords;
        resultSummary.failedCount += aiRes.failed;

        setProgress(prev => ({
          ...prev,
          currentStage: 'Привязка разбора к заметкам...',
          summariesCount: aiRes.summaries,
          localStoreCount: aiRes.localStoreRecords,
          percent: 90,
        }));

        await reattachOrphanedAnalysis();
      }

      setProgress(prev => ({
        ...prev,
        currentStage: 'Восстановление завершено',
        percent: 100,
      }));

      setReport(resultSummary);
      // AUD-12: восстановившее ноль заметок — не «завершённое» восстановление.
      if (resultSummary.restoredNotes === 0
        && resultSummary.restoredSummaries === 0
        && resultSummary.restoredAIStoreRecords === 0) {
        setStep('failed');
      } else {
        setRestoreDismissed(user.uid, true);
        setStep('completed');
      }
    } catch {
      // AUD-12: исключение больше не рисует «завершено». Говорим, что не вышло,
      // и сколько успело вернуться до падения.
      setReport(resultSummary);
      setStep('failed');
    }
  };

  const handleEnableAutoSync = () => {
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED, 'true');
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

  const isAutoSyncAlreadyEnabled = localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED) === 'true';

  return (
    <ModalWrapper
      isOpen={open}
      onClose={() => { if (step !== 'restoring') onClose(); }}
      titleId="restore-cloud-title"
      maxWidth="max-w-md"
    >
      <div className="space-y-4 p-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-soft/10 text-brand-soft flex items-center justify-center border border-brand-soft/20 shrink-0">
            <CloudDownload className="w-5 h-5" />
          </div>
          <div>
            <h2 id="restore-cloud-title" className="text-base font-semibold text-text-main">
              {step === 'completed'
                ? 'Восстановление завершено'
                : step === 'failed'
                  ? 'Восстановление не удалось'
                  : 'Загрузка данных из облака'}
            </h2>
          </div>
        </div>

        {step === 'idle' && (
          <div className="space-y-4">
            <p className="text-xs text-text-main/70 leading-relaxed">
              {localCount === 0
                ? `На этом устройстве пока нет ваших записей, а в облаке сохранено ${loadingCounts ? '...' : cloudCount}. Хотите загрузить их сейчас?`
                : `На этом устройстве ${loadingCounts ? '...' : localCount} заметок, а в облаке найдено ${loadingCounts ? '...' : cloudCount}. Хотите синхронизировать недостающие данные?`}
            </p>

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
                    Заметки и история версий
                  </div>
                  <div className="text-[11px] text-text-main/60">
                    Все тексты, сессии и правки ({cloudCount} заметок в облаке)
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
                    Разбор ИИ и поиск
                  </div>
                  <div className="text-[11px] text-text-main/60">
                    Сводки, ключевые темы, инсайты и векторы семантического поиска
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
                    Личность, диалоги и история жизни
                  </div>
                  <div className="text-[11px] text-text-main/60">
                    Портрет, грани профиля, история чатов, реестр тем и убеждения
                  </div>
                </div>
              </label>
            </div>

            <div className="pt-3 border-t border-border-subtle flex items-center justify-between">
              <Button onClick={handleDismiss} className="px-3 py-1.5 text-xs text-text-main/60 hover:text-text-main">
                Не сейчас
              </Button>
              <Button
                onClick={() => void handleStartRestore()}
                disabled={!includeNotes && !includeSummaries && !includeAIData}
                className="px-4 py-2 text-xs font-semibold bg-brand-soft text-surface-base hover:opacity-90 flex items-center gap-1.5"
              >
                <CloudDownload className="w-4 h-4" />
                Начать загрузку
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
                  <span>Загружено заметок:</span>
                  <span className="text-text-main font-medium">{progress.notesCurrent} / {progress.notesTotal}</span>
                </div>
              )}
              {progress.summariesCount > 0 && (
                <div className="flex justify-between">
                  <span>Восстановлено сводок:</span>
                  <span className="text-text-main font-medium">{progress.summariesCount}</span>
                </div>
              )}
              {progress.localStoreCount > 0 && (
                <div className="flex justify-between">
                  <span>Записей ИИ и диалогов:</span>
                  <span className="text-text-main font-medium">{progress.localStoreCount}</span>
                </div>
              )}
            </div>

            <p className="text-[11px] text-text-main/50 text-center italic">
              Пожалуйста, не закрывайте вкладку до завершения загрузки.
            </p>
          </div>
        )}

        {step === 'failed' && (
          <div className="space-y-4">
            <div className="p-3.5 bg-accent-danger/10 border border-accent-danger/20 rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-accent-danger">
                <AlertTriangle className="w-4 h-4 text-accent-danger" />
                Восстановление прервано ошибкой. Попробуйте ещё раз позже.
              </div>
              {/* Частичный успех — числами: что успело вернуться до падения. */}
              {(Boolean(report?.restoredNotes) || Boolean(report?.restoredSummaries) || Boolean(report?.restoredAIStoreRecords)) && (
                <div className="text-[11px] text-text-main/70 space-y-1 pl-6">
                  {Boolean(report?.restoredNotes) && <div>Заметок восстановлено: <strong className="text-text-main">{report?.restoredNotes}</strong></div>}
                  {Boolean(report?.restoredSummaries) && <div>Сводок ИИ: <strong className="text-text-main">{report?.restoredSummaries}</strong></div>}
                  {Boolean(report?.restoredAIStoreRecords) && <div>Записей ИИ: <strong className="text-text-main">{report?.restoredAIStoreRecords}</strong></div>}
                </div>
              )}
            </div>

            <div className="pt-2 flex items-center justify-end gap-2">
              <Button onClick={handleDismiss} className="px-3 py-1.5 text-xs text-text-main/60 hover:text-text-main">
                Не сейчас
              </Button>
              <Button
                onClick={() => void handleStartRestore()}
                className="px-4 py-2 text-xs font-semibold bg-brand-soft text-surface-base hover:opacity-90"
              >
                Повторить
              </Button>
            </div>
          </div>
        )}

        {step === 'completed' && (
          <div className="space-y-4">
            <div className="p-3.5 bg-accent/10 border border-accent/20 rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-accent">
                <CheckCircle className="w-4 h-4 text-accent" />
                Данные успешно загружены
              </div>
              <div className="text-[11px] text-text-main/70 space-y-1 pl-6">
                <div>Заметок восстановлено: <strong className="text-text-main">{report?.restoredNotes ?? 0}</strong></div>
                <div>Сводок ИИ: <strong className="text-text-main">{report?.restoredSummaries ?? 0}</strong></div>
                <div>Записей ИИ (диалоги, портрет, темы): <strong className="text-text-main">{report?.restoredAIStoreRecords ?? 0}</strong></div>
                {Boolean(report?.failedCount) && (
                  <div className="text-amber-400 flex items-center gap-1 mt-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Пропущено с ошибкой: {report?.failedCount}
                  </div>
                )}
              </div>
            </div>

            {!isAutoSyncAlreadyEnabled && !autoSyncPromptAnswered && (
              <div className="p-3 bg-surface-base border border-border-subtle rounded-xl space-y-2">
                <div className="text-xs font-medium text-text-main">
                  Включить автосинхронизацию на этом устройстве?
                </div>
                <div className="text-[11px] text-text-main/60">
                  Новые заметки и правки будут автоматически сохраняться в облако.
                </div>
                <div className="flex gap-2 pt-1">
                  <Button onClick={handleEnableAutoSync} className="px-3 py-1.5 text-xs bg-brand-soft text-surface-base hover:opacity-90">
                    Включить автосинк
                  </Button>
                  <Button onClick={handleSkipAutoSync} className="px-3 py-1.5 text-xs text-text-main/60 hover:text-text-main">
                    Оставить ручную
                  </Button>
                </div>
              </div>
            )}

            <div className="pt-2 flex justify-end">
              <Button onClick={onClose} className="px-4 py-2 text-xs font-semibold bg-surface-base border border-border-subtle text-text-main hover:bg-surface-card">
                {t('common_done') || 'Готово'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </ModalWrapper>
  );
}
