import { useState, useEffect } from 'react';
import { AIConsolidationService, type AIBelief, type RejectedBeliefRecord } from '../services/AIConsolidationService';
import { Button } from '../../../shared/components/Button';
import { cn } from '../../../core/utils/utils';
import { Brain, CheckCircle, AlertTriangle, RefreshCw, Trash2, ShieldAlert, History } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n';

export function BeliefsDiagnostics() {
  const { t } = useLanguage();
  const [beliefs, setBeliefs] = useState<AIBelief[]>([]);
  const [rejections, setRejections] = useState<RejectedBeliefRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshData = async () => {
    setLoading(true);
    try {
      setError(null);
      const [pubBeliefs, rejRecords] = await Promise.all([
        AIConsolidationService.getAllBeliefs(),
        AIConsolidationService.getAllRejections(100),
      ]);
      setBeliefs(pubBeliefs);
      setRejections(rejRecords);
    } catch {
      setError(t('admin_beliefs_load_error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetching from IndexedDB on mount
    void refreshData();
    // Загрузка один раз при монтировании: refreshData читает t только для текста
    // ошибки, повторять выборку из базы при смене языка незачем.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClearRejections = async () => {
    await AIConsolidationService.clearRejections();
    await refreshData();
  };

  const publishedCount = beliefs.length;
  // Only verdicts the judge actually returned say anything about its calibration.
  // Records where we never got a verdict (provider/quota failure) are counted
  // separately — folding them in would make a flaky upstream read as "the judge
  // is too strict" and push us to loosen a judge that is working fine.
  const judgeRejectedCount = rejections.filter(r => r.kind !== 'evaluation_failed').length;
  const evaluationFailedCount = rejections.filter(r => r.kind === 'evaluation_failed').length;
  const totalEvaluated = publishedCount + judgeRejectedCount;
  const rejectRate = totalEvaluated > 0 ? (judgeRejectedCount / totalEvaluated) * 100 : 0;

  const passedDirectCount = beliefs.filter(b => b.judgeVerdict === 'PASSED').length;
  const rewrittenPassedCount = beliefs.filter(b => b.judgeVerdict === 'REWRITTEN_PASSED').length;
  const rewriteShare = publishedCount > 0 ? (rewrittenPassedCount / publishedCount) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Header & Control Actions */}
      <div className="p-4 bg-surface-card/60 border border-border-subtle rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-accent-main" />
            <h3 className="text-sm font-bold text-text-main">{t('admin_beliefs_diag_title')}</h3>
          </div>
          <p className="text-xs text-text-main/60 mt-1">
            {t('admin_beliefs_diag_desc')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={() => void refreshData()}
            className="px-3 py-1.5 rounded-xl text-xs font-medium bg-surface-base/60 text-text-main border border-border-subtle flex items-center gap-1.5"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            {t('admin_refresh')}
          </Button>
          <Button
            onClick={() => void handleClearRejections()}
            className="px-3 py-1.5 rounded-xl text-xs font-medium bg-status-error/10 text-status-error border border-status-error/20 flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t('admin_beliefs_clear_log')}
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-status-error/10 text-status-error p-4 rounded-2xl flex items-start gap-3 border border-status-error/20">
          <ShieldAlert className="w-5 h-5 mt-0.5 shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-surface-card/40 border border-border-subtle rounded-2xl space-y-1">
          <span className="text-xs font-medium text-text-main/60">{t('admin_beliefs_kpi_published')}</span>
          <div className="text-xl font-bold text-status-success">{publishedCount}</div>
          <div className="text-[10px] text-text-main/50">{t('admin_beliefs_kpi_passed_judge')}</div>
        </div>

        <div className="p-4 bg-surface-card/40 border border-border-subtle rounded-2xl space-y-1">
          <span className="text-xs font-medium text-text-main/60">{t('admin_beliefs_kpi_rejected')}</span>
          <div className="text-xl font-bold text-status-error">{judgeRejectedCount}</div>
          <div className="text-[10px] text-text-main/50">
            {t('admin_beliefs_kpi_blocked_distortions')}{evaluationFailedCount > 0 ? t('admin_beliefs_kpi_no_verdict', { count: evaluationFailedCount }) : ''}
          </div>
        </div>

        <div className="p-4 bg-surface-card/40 border border-border-subtle rounded-2xl space-y-1">
          <span className="text-xs font-medium text-text-main/60">{t('admin_beliefs_kpi_reject_rate')}</span>
          <div className="text-xl font-bold text-text-main">{rejectRate.toFixed(1)}%</div>
          <div className="text-[10px] text-text-main/50">{t('admin_beliefs_kpi_expected_reject')}</div>
        </div>

        <div className="p-4 bg-surface-card/40 border border-border-subtle rounded-2xl space-y-1">
          <span className="text-xs font-medium text-text-main/60">{t('admin_beliefs_kpi_rewrite_share')}</span>
          <div className="text-xl font-bold text-text-main">{rewriteShare.toFixed(1)}%</div>
          <div className="text-[10px] text-text-main/50">{t('admin_beliefs_kpi_passed_rewritten', { passed: passedDirectCount, rewritten: rewrittenPassedCount })}</div>
        </div>
      </div>

      {/* Judge Calibration Status Banner */}
      <div className={cn(
        "p-4 rounded-2xl border flex items-center justify-between gap-3 text-xs font-medium",
        totalEvaluated === 0
          ? "bg-surface-card/40 border-border-subtle text-text-main/60"
          : (rejectRate > 50 || (publishedCount > 5 && rewriteShare > 75))
            ? "bg-status-warning/10 border-status-warning/30 text-status-warning"
            : "bg-status-success/10 border-status-success/30 text-status-success"
      )}>
        <div className="flex items-center gap-2">
          {totalEvaluated === 0 ? (
            <History className="w-4 h-4" />
          ) : (rejectRate > 50 || (publishedCount > 5 && rewriteShare > 75)) ? (
            <AlertTriangle className="w-4 h-4" />
          ) : (
            <CheckCircle className="w-4 h-4" />
          )}
          <span>
            {totalEvaluated === 0
              ? t('admin_beliefs_status_no_data')
              : (rejectRate > 50 || (publishedCount > 5 && rewriteShare > 75))
                ? t('admin_beliefs_status_warn')
                : t('admin_beliefs_status_ok')}
          </span>
        </div>
      </div>

      {/* Section 1: Rejections Log */}
      <div className="p-4 bg-surface-card/40 border border-border-subtle rounded-2xl space-y-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-status-error" />
          <h4 className="text-xs font-bold text-text-main uppercase tracking-wider">
            {t('admin_beliefs_rejections_title', { count: rejections.length })}
          </h4>
        </div>

        {rejections.length === 0 ? (
          <div className="text-xs text-text-main/50 py-4 text-center">
            {t('admin_beliefs_rejections_empty')}
          </div>
        ) : (
          <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
            {rejections.map(rej => (
              <div key={rej.id} className="p-3 bg-surface-base/30 border border-border-subtle rounded-xl space-y-2 text-xs">
                <div className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-text-main/60">{rej.id}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-status-error/10 text-status-error border border-status-error/20">
                      REJECTED
                    </span>
                    {rej.rewriteAttempted && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-surface-card text-text-main/60 border border-border-subtle">
                        Rewrite Attempted
                      </span>
                    )}
                  </div>
                  <span className="text-text-main/50">{new Date(rej.timestamp).toLocaleString()}</span>
                </div>

                <div className="text-text-main font-medium">
                  «{rej.rejectedTextSnippet}»
                </div>

                <div className="p-2 bg-status-error/5 border border-status-error/10 rounded-lg text-[11px] text-status-error">
                  <strong>{t('admin_beliefs_rejection_reason')}</strong> {rej.reason}
                </div>

                <div className="flex items-center justify-between text-[10px] text-text-main/50">
                  <span>{t('admin_beliefs_cluster_meta', { size: rej.clusterSize, firstSeen: rej.firstSeenAt })}</span>
                  <span>{t('admin_beliefs_units_meta', { units: rej.unitIds.join(', ') })}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section 2: Published Beliefs (Read-Only) */}
      <div className="p-4 bg-surface-card/40 border border-border-subtle rounded-2xl space-y-3">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-status-success" />
          <h4 className="text-xs font-bold text-text-main uppercase tracking-wider">
            {t('admin_beliefs_published_title', { count: beliefs.length })}
          </h4>
        </div>

        {beliefs.length === 0 ? (
          <div className="text-xs text-text-main/50 py-4 text-center">
            {t('admin_beliefs_published_empty')}
          </div>
        ) : (
          <div className="space-y-3 max-h-[450px] overflow-y-auto pr-1">
            {beliefs.map(b => (
              <div key={b.id} className="p-3.5 bg-surface-base/30 border border-border-subtle rounded-xl space-y-2 text-xs">
                <div className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-text-main/60">{b.id}</span>
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-[10px] font-bold border",
                      b.judgeVerdict === 'PASSED'
                        ? "bg-status-success/10 text-status-success border-status-success/20"
                        : "bg-accent-main/10 text-accent-main border-accent-main/20"
                    )}>
                      {b.judgeVerdict}
                    </span>
                  </div>
                  <span className="text-text-main/50">{t('admin_beliefs_first_seen', { date: b.firstSeenAt })}</span>
                </div>

                <div className="text-text-main font-semibold text-sm">
                  «{b.belief}»
                </div>

                {b.judgeReason && (
                  <div className="text-[11px] text-text-main/70 bg-surface-card/60 p-2 rounded-lg border border-border-subtle">
                    <strong>{t('admin_beliefs_judge_verdict')}</strong> {b.judgeReason}
                  </div>
                )}

                {/* Evidence List */}
                <div className="space-y-1.5 pt-1">
                  <span className="text-[10px] font-bold text-text-main/60 uppercase">{t('admin_beliefs_evidence_title')}</span>
                  <div className="space-y-1">
                    {b.evidence.map(ev => (
                      <div key={ev.id} className="p-2 bg-surface-card/40 rounded-lg text-[11px] border border-border-subtle flex flex-col gap-0.5">
                        <div className="flex items-center justify-between text-[10px] text-text-main/60">
                          <span className="font-mono">#{ev.id}</span>
                          <span>{ev.date}</span>
                        </div>
                        {ev.snippet && <div className="text-text-main/80 italic">«{ev.snippet}»</div>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
