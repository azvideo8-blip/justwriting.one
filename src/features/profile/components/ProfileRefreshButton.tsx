import { useState } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '../../../shared/components/Button';
import { useToast } from '../../../shared/components/Toast';
import { useDailyLimit } from '../../ai/hooks/useDailyLimit';
import { useAiLimitStore } from '../../ai/store/useAiLimitStore';
import {
  AIProfileRefreshService,
  type RefreshEstimate,
  type RefreshStepKey,
} from '../../ai/services/AIProfileRefreshService';
import { reportError } from '../../../shared/errors/reportError';

/**
 * «Обновить профиль» — единственный способ пересчитать портрет, грани, реестр
 * тем, дайджесты и убеждения после того, как фоновый проход убран (D4.23).
 *
 * Окно перед запуском показывает цену: сколько будет вызовов ИИ, сколько это
 * займёт и сколько останется от дневного лимита. Списывается из того же лимита,
 * что и чат, — иначе обновление бесплатно, и жать его можно бесконечно.
 */

const STEP_LABELS: Record<RefreshStepKey, string> = {
  facets: 'Грани профиля',
  judge: 'Проверка граней',
  portrait: 'Портрет',
  themes: 'Реестр тем',
  digests: 'Месячные обзоры',
  consolidation: 'Убеждения',
};

function formatDuration(seconds: number): string {
  if (seconds < 90) return 'около минуты';
  return `примерно ${Math.round(seconds / 60)} мин`;
}

export function ProfileRefreshButton() {
  const { showToast } = useToast();
  const { remaining, limit } = useDailyLimit();
  const [estimate, setEstimate] = useState<RefreshEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [running, setRunning] = useState<RefreshStepKey | null>(null);

  const openDialog = async () => {
    setEstimating(true);
    try {
      setEstimate(await AIProfileRefreshService.estimate());
    } catch (e) {
      reportError(e, { action: 'profileRefresh_estimate' });
      showToast('Не удалось посчитать объём обновления', 'error');
    } finally {
      setEstimating(false);
    }
  };

  const start = async () => {
    const planned = estimate;
    setEstimate(null);
    if (!planned) return;
    setRunning('facets');
    try {
      const { failed } = await AIProfileRefreshService.run(p => setRunning(p.step));
      // Счётчик лимита на клиенте догоняет сервер: каждый вызов там уже списан.
      const store = useAiLimitStore.getState();
      for (let i = 0; i < planned.totalCalls; i++) store.useRequest();
      void store.loadLimitFromServer();

      if (failed.length === 0) {
        showToast('Профиль обновлён', 'success');
      } else {
        showToast(`Обновлено частично: не вышло — ${failed.map(f => STEP_LABELS[f].toLowerCase()).join(', ')}`, 'error');
      }
    } catch (e) {
      reportError(e, { action: 'profileRefresh_run' });
      showToast('Обновление не удалось', 'error');
    } finally {
      setRunning(null);
    }
  };

  const notEnough = estimate !== null && estimate.totalCalls > remaining;
  const nothingToDo = estimate !== null && estimate.totalCalls === 0;

  return (
    <>
      <Button
        onClick={() => void openDialog()}
        disabled={estimating || running !== null}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-brand-soft/10 border border-brand-soft/25 text-sm font-semibold text-brand-soft hover:bg-brand-soft/20 transition-colors disabled:opacity-60"
      >
        {running !== null ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            {STEP_LABELS[running]}…
          </>
        ) : estimating ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            Считаю объём…
          </>
        ) : (
          <>
            <RefreshCw size={16} />
            Обновить профиль
          </>
        )}
      </Button>

      {estimate !== null && (
        <div
          className="fixed inset-0 z-[var(--z-critical)] flex items-center justify-center bg-surface-base/60 backdrop-blur-sm p-4"
          onClick={() => setEstimate(null)}
        >
          <div
            className="w-full max-w-sm bg-surface-card border border-border-subtle rounded-2xl p-5 shadow-lg"
            onClick={e => e.stopPropagation()}
          >
            <div className="text-sm font-semibold text-text-main mb-1">Обновить профиль</div>

            {nothingToDo ? (
              <p className="text-xs text-text-main/60 mb-4">
                Пересчитывать нечего: с прошлого обновления не появилось ни одной разобранной заметки.
                Разберите заметку кнопкой ✨ в архиве — и возвращайтесь.
              </p>
            ) : (
              <>
                <p className="text-xs text-text-main/60 mb-3">
                  Обновление займёт {formatDuration(estimate.seconds)}. Не закрывайте вкладку.
                </p>

                <div className="space-y-1 mb-3">
                  {estimate.steps.map(s => (
                    <div key={s.key} className="flex items-center justify-between text-xs">
                      <span className="text-text-main/70">{STEP_LABELS[s.key]}</span>
                      <span className="text-text-main/50 font-mono">~{s.calls}</span>
                    </div>
                  ))}
                </div>

                <div className="border-t border-border-subtle pt-3 mb-4 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-text-main/70">Всего вызовов ИИ</span>
                    <span className="text-text-main font-mono">~{estimate.totalCalls}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-text-main/70">Дневной лимит</span>
                    <span className={notEnough ? 'text-accent-danger font-mono' : 'text-text-main/50 font-mono'}>
                      {remaining} из {limit} осталось
                    </span>
                  </div>
                </div>

                {notEnough && (
                  <p className="text-xs text-accent-danger mb-4">
                    На это не хватит лимита: нужно ~{estimate.totalCalls}, осталось {remaining}.
                    Лимит обновится завтра.
                  </p>
                )}
              </>
            )}

            <div className="flex gap-2">
              {!nothingToDo && (
                <Button
                  onClick={() => void start()}
                  disabled={notEnough}
                  className="flex-1 py-2 rounded-xl bg-brand-soft text-white text-sm font-semibold hover:bg-brand-soft-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Обновить
                </Button>
              )}
              <Button
                onClick={() => setEstimate(null)}
                className="flex-1 py-2 rounded-xl border border-border-subtle text-text-main/60 text-sm hover:text-text-main transition-colors"
              >
                {nothingToDo ? 'Понятно' : 'Отмена'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
