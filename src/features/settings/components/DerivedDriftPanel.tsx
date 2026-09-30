import { useState } from 'react';
import { Loader2, RefreshCw, Scale } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n';
import { useToast } from '../../../shared/components/Toast';
import { Button } from '../../../shared/components/Button';
import { reportError } from '../../../shared/errors/reportError';
import { cn } from '../../../core/utils/utils';

/** Одно семейство в сверке. `null` — не удалось посчитать; это не ноль. */
interface DriftFamilyView { local: number | null; cloud: number | null }

export interface DerivedDriftView {
  notes: number | null;
  summaries: DriftFamilyView & { orphaned: number | null };
  embeddings: DriftFamilyView & { orphaned: number | null; oversized: number | null };
  stores: DriftFamilyView;
}

interface DerivedDriftPanelProps {
  userId: string;
  onLoad: (userId: string) => Promise<DerivedDriftView>;
}

/**
 * Сверка «на устройстве / в облаке» для данных ИИ (drift-1).
 *
 * Считает только по нажатию: ни при открытии настроек, ни по таймеру — каждый
 * пересчёт это запросы к облаку и чтение векторов с диска.
 */
export function DerivedDriftPanel({ userId, onLoad }: DerivedDriftPanelProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [drift, setDrift] = useState<DerivedDriftView | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCheck = async () => {
    setLoading(true);
    try {
      setDrift(await onLoad(userId));
    } catch (err) {
      // Прежние числа убираем: рядом с ошибкой они читались бы как свежие.
      setDrift(null);
      reportError(err, { action: 'derivedDriftCheck' });
      showToast(t('error_generic_action'), 'error');
    } finally {
      setLoading(false);
    }
  };

  // K-4/N-85: null рисуется словами. Ноль на этом месте значил бы «данных нет».
  const num = (v: number | null) => (v === null ? t('settings_drift_unknown') : String(v));

  const rows = drift === null ? null : ([
    ['summaries', t('settings_drift_row_summaries'), drift.summaries],
    ['embeddings', t('settings_drift_row_embeddings'), drift.embeddings],
    ['stores', t('settings_drift_row_stores'), drift.stores],
  ] as const);

  const anyMissing = rows?.some(([, , f]) => f.local !== null && f.cloud !== null && f.local > f.cloud) ?? false;
  const indexed = drift !== null && drift.embeddings.local !== null && drift.embeddings.oversized !== null
    ? drift.embeddings.local + drift.embeddings.oversized
    : null;

  return (
    <div className="p-3 rounded-lg border border-border-subtle bg-surface-base/30 space-y-3" data-testid="derived-drift-panel">
      {/* На узком экране кнопка уходит под заголовок, а не за край карточки. */}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="space-y-0.5 min-w-0 flex-1 basis-48">
          <span className="text-sm font-medium text-text-main flex items-center gap-2">
            <Scale size={16} className="shrink-0 text-text-main/60" />
            {t('settings_drift_title')}
          </span>
          <p className="text-xs text-text-main/60">{t('settings_drift_desc')}</p>
        </div>
        <Button
          onClick={() => void handleCheck()}
          disabled={loading}
          data-testid="derived-drift-check-btn"
          className="shrink-0 px-3 py-1.5 rounded-lg border border-border-subtle text-xs text-text-main/70 hover:text-text-main transition-colors"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          {drift ? t('settings_drift_refresh') : t('settings_drift_check')}
        </Button>
      </div>

      {rows !== null && drift !== null && (
        <div className="space-y-2" aria-live="polite">
          <ul className="space-y-2">
            {rows.map(([id, label, f]) => {
              const diff = f.local !== null && f.cloud !== null ? f.local - f.cloud : null;
              return (
                <li key={id} data-testid={`drift-row-${id}`} className="text-xs">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-text-main">{label}</span>
                    {diff !== null && (
                      <span className={cn(
                        'font-semibold tabular-nums text-right',
                        diff > 0 ? 'text-accent-warning' : diff === 0 ? 'text-accent-success' : 'text-text-main/60',
                      )}>
                        {diff > 0 && t('settings_drift_missing', { count: diff })}
                        {diff === 0 && t('settings_drift_match')}
                        {diff < 0 && t('settings_drift_extra', { count: -diff })}
                      </span>
                    )}
                  </div>
                  <p className="text-text-main/60 tabular-nums">
                    {t('settings_drift_col_local')}: {num(f.local)}
                    <span aria-hidden="true"> · </span>
                    {t('settings_drift_col_cloud')}: {num(f.cloud)}
                  </p>
                </li>
              );
            })}
          </ul>

          <div className="space-y-0.5 text-[11px] text-text-main/60 tabular-nums">
            {drift.notes !== null && indexed !== null && indexed < drift.notes ? (
              <p className="text-accent-warning">
                {t('settings_drift_vectors_behind', { vectors: indexed, notes: drift.notes })}
              </p>
            ) : !!drift.notes && (
              <p>{t('settings_drift_notes', { count: drift.notes })}</p>
            )}
            {!!drift.summaries.orphaned && (
              <p>{t('settings_drift_orphan_summaries', { count: drift.summaries.orphaned })}</p>
            )}
            {!!drift.embeddings.orphaned && (
              <p>{t('settings_drift_orphan_embeddings', { count: drift.embeddings.orphaned })}</p>
            )}
            {!!drift.embeddings.oversized && (
              <p>{t('settings_drift_oversized', { count: drift.embeddings.oversized })}</p>
            )}
            {anyMissing && <p className="text-text-main/80">{t('settings_drift_hint_missing')}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
