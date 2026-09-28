import { useState, useEffect } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '../../../shared/components/Button';
import { useToast } from '../../../shared/components/Toast';
import { useDailyLimit } from '../hooks/useDailyLimit';
import { useAiLimitStore } from '../store/useAiLimitStore';
import {
  AIProfileRefreshService,
  type RefreshEstimate,
  type RefreshStepKey,
} from '../services/AIProfileRefreshService';
import { reportError } from '../../../shared/errors/reportError';
import { ModalShell } from '../../../shared/components/ModalShell';
import { useLanguage } from '../../../shared/i18n';

/**
 * «Обновить профиль» — единственный способ пересчитать портрет, грани, реестр
 * тем, дайджесты и убеждения после того, как фоновый проход убран (D4.23).
 *
 * Окно перед запуском показывает цену: сколько будет вызовов ИИ, сколько это
 * займёт и сколько останется от дневного лимита. Списывается из того же лимита,
 * что и чат, — иначе обновление бесплатно, и жать его можно бесконечно.
 */

const getStepLabel = (step: RefreshStepKey, t: (k: string) => string) => {
  return t(`ai_refresh_step_${step}`);
};

function formatDuration(seconds: number, t: (k: string, p?: Record<string, string>) => string): string {
  if (seconds < 90) return t('ai_refresh_duration_about_minute');
  return t('ai_refresh_duration_minutes', { count: String(Math.round(seconds / 60)) });
}

export function ProfileRefreshButton() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { remaining, limit } = useDailyLimit();
  const [estimate, setEstimate] = useState<RefreshEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [running, setRunning] = useState<RefreshStepKey | null>(() => AIProfileRefreshService.getCurrentStep());

  useEffect(() => {
    return AIProfileRefreshService.subscribe(setRunning);
  }, []);

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
        showToast(`Обновлено частично: не вышло — ${failed.map(f => getStepLabel(f, t).toLowerCase()).join(', ')}`, 'error');
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
            {getStepLabel(running, t)}…
          </>
        ) : estimating ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            {t('ai_refresh_estimating')}
          </>
        ) : (
          <>
            <RefreshCw size={16} />
            {t('ai_refresh_btn')}
          </>
        )}
      </Button>

      {estimate !== null && (
        <ModalShell
          open={estimate !== null}
          onClose={() => setEstimate(null)}
          labelId="profile-refresh-modal-title"
          className="w-full max-w-sm bg-surface-card border border-border-subtle rounded-2xl p-5 shadow-lg"
        >
          <div id="profile-refresh-modal-title" className="text-sm font-semibold text-text-main mb-1">{t('ai_refresh_btn')}</div>

          {nothingToDo ? (
            <p className="text-xs text-text-main/60 mb-4">
              {t('ai_refresh_empty')}
            </p>
          ) : (
            <>
              <p className="text-xs text-text-main/60 mb-3">
                {t('ai_refresh_duration_notice', { duration: formatDuration(estimate.seconds, t) })}
              </p>

              <div className="space-y-1 mb-3">
                {estimate.steps.map(s => (
                  <div key={s.key} className="flex items-center justify-between text-xs">
                    <span className="text-text-main/70">{getStepLabel(s.key, t)}</span>
                    <span className="text-text-main/50 font-mono">~{s.calls}</span>
                  </div>
                ))}
              </div>

              <div className="border-t border-border-subtle pt-3 mb-4 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-main/70">{t('ai_refresh_total_calls')}</span>
                  <span className="text-text-main font-mono">~{estimate.totalCalls}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-main/70">{t('ai_refresh_daily_limit')}</span>
                  <span className={notEnough ? 'text-accent-danger font-mono' : 'text-text-main/50 font-mono'}>
                    {t('ai_refresh_remaining_of_limit', { remaining: String(remaining), limit: String(limit) })}
                  </span>
                </div>
              </div>

              {notEnough && (
                <p className="text-xs text-accent-danger mb-4">
                  {t('ai_refresh_not_enough_limit', { needed: String(estimate.totalCalls), remaining: String(remaining) })}
                </p>
              )}
            </>
          )}

          <div className="flex gap-2">
            {!nothingToDo && (
              <Button
                onClick={() => void start()}
                disabled={notEnough}
                className="flex-1 py-2 rounded-xl bg-brand-soft text-surface-base text-sm font-semibold hover:bg-brand-soft-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t('ai_refresh_confirm_btn')}
              </Button>
            )}
            <Button
              onClick={() => setEstimate(null)}
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
