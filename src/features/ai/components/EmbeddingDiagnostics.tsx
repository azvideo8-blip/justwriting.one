import { useState, useEffect, useCallback } from 'react';
import { Loader2, RefreshCw, Sparkles, Search, CloudUpload, RotateCcw } from 'lucide-react';
import { cn } from '../../../core/utils/utils';
import { Button } from '../../../shared/components/Button';
import { Input } from '../../../shared/components/Input';
import { useToast } from '../../../shared/components/Toast';
import { useConfirmDialog } from '../../../shared/components/ConfirmDialog';
import { getIndexCoverage, indexPending, reindexAll, type IndexCoverage } from '../utils/embeddingIndexer';
import { searchNotes, type RetrievedNote } from '../utils/noteRetriever';
import { AIEmbeddingService } from '../services/AIEmbeddingService';

import { reportError } from '../../../shared/errors/reportError';
import { useLanguage } from '../../../shared/i18n';

export function EmbeddingDiagnostics() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { confirm: confirmDialog } = useConfirmDialog();
  const [coverage, setCoverage] = useState<IndexCoverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [indexing, setIndexing] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const [syncing, setSyncing] = useState(false);

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<RetrievedNote[] | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setCoverage(await getIndexCoverage());
    } catch (e) {
      reportError(e, { action: 'embedding_diagnostics_coverage' });
      showToast(t('admin_embed_toast_status_error'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch on mount/refresh
  useEffect(() => { void refresh(); }, [refresh]);

  const handleIndexNow = async () => {
    setIndexing(true);
    setProgress({ done: 0, total: coverage?.stale ?? 0 });
    try {
      const summary = await indexPending({
        onProgress: (done, total) => setProgress({ done, total }),
      });
      if (summary.stopped === 'daily') showToast(t('admin_embed_toast_daily_limit'), 'error');
      else if (summary.stopped === 'rate') showToast(t('admin_embed_toast_rate_limit'), 'error');
      else showToast(t('admin_embed_toast_index_summary', { ok: summary.ok, skipped: summary.skipped, failed: summary.failed }), 'success');
    } catch (e) {
      reportError(e, { action: 'embedding_diagnostics_index' });
      showToast(t('admin_embed_toast_index_error'), 'error');
    } finally {
      setIndexing(false);
      setProgress(null);
      void refresh();
    }
  };

  const handleReindexAll = async () => {
    const total = coverage?.totalDocs ?? 0;
    const ok = await confirmDialog({
      title: t('admin_embed_reindex_all_confirm_title'),
      message: t('admin_embed_reindex_all_confirm_message', { total: String(total) }),
    });
    if (!ok) return;
    setReindexing(true);
    setProgress({ done: 0, total });
    try {
      const summary = await reindexAll({ onProgress: (done, t) => setProgress({ done, total: t }) });
      if (summary.stopped === 'daily') showToast(t('admin_embed_toast_reindex_daily'), 'error');
      else if (summary.stopped === 'rate') showToast(t('admin_embed_toast_reindex_rate'), 'error');
      else showToast(t('admin_embed_toast_reindex_summary', { ok: summary.ok, skipped: summary.skipped, failed: summary.failed }), 'success');
    } catch (e) {
      reportError(e, { action: 'embedding_diagnostics_reindex' });
      showToast(t('admin_embed_toast_reindex_error'), 'error');
    } finally {
      setReindexing(false);
      setProgress(null);
      void refresh();
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const r = await AIEmbeddingService.syncPendingToCloud();
      if (r.locked) showToast(t('admin_embed_toast_sync_locked', { synced: r.synced }), 'error');
      else if (r.synced > 0) showToast(t('admin_embed_toast_sync_count', { synced: r.synced }), 'success');
      else showToast(t('admin_embed_toast_sync_all_done'), 'success');
    } catch (e) {
      reportError(e, { action: 'embedding_diagnostics_sync' });
      showToast(t('admin_embed_toast_sync_error'), 'error');
    } finally {
      setSyncing(false);
      void refresh();
    }
  };

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setResults(null);
    try {
      setResults(await searchNotes(q, 5));
    } catch (e) {
      reportError(e, { action: 'embedding_diagnostics_search' });
      showToast(t('admin_embed_toast_search_error'), 'error');
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const pct = coverage && coverage.totalDocs > 0
    ? Math.round((coverage.indexed / coverage.totalDocs) * 100)
    : 0;

  return (
    <div className="space-y-4 mb-6">
      {/* Coverage card */}
      <div className="p-5 rounded-2xl border border-border-subtle bg-surface-base/5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-semibold text-text-main flex items-center gap-2">
            <Sparkles size={15} className="text-brand-soft" />
            {t('admin_embed_card_title')}
          </h3>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => void refresh()}
              disabled={loading || indexing || reindexing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border-subtle bg-surface-base/5 text-text-main/60 text-xs font-semibold disabled:opacity-50 transition-colors"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {t('admin_refresh')}
            </Button>
            <Button
              onClick={() => void handleSync()}
              disabled={syncing || indexing || reindexing || loading || (coverage?.unsynced ?? 0) === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border-subtle bg-surface-base/5 text-text-main/60 text-xs font-semibold disabled:opacity-50 transition-colors min-h-[34px]"
            >
              {syncing ? <Loader2 size={12} className="animate-spin" /> : <CloudUpload size={12} />}
              {(coverage?.unsynced ?? 0) === 0 ? t('admin_embed_synced') : t('admin_embed_upload', { count: coverage?.unsynced ?? 0 })}
            </Button>
            <Button
              onClick={() => void handleReindexAll()}
              disabled={indexing || reindexing || loading || (coverage?.totalDocs ?? 0) === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border-subtle bg-surface-base/5 text-text-main/60 text-xs font-semibold disabled:opacity-50 transition-colors min-h-[34px]"
            >
              {reindexing ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
              {reindexing && progress ? t('admin_embed_reindexing_progress', { done: progress.done, total: progress.total }) : t('admin_embed_reindex_all')}
            </Button>
            <Button
              onClick={() => void handleIndexNow()}
              disabled={indexing || reindexing || loading || (coverage?.stale ?? 0) === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-text-main text-surface-base text-xs font-semibold disabled:opacity-50 transition-colors min-h-[34px]"
            >
              {indexing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {indexing && progress
                ? t('admin_embed_indexing_progress', { done: progress.done, total: progress.total })
                : (coverage?.stale ?? 0) === 0 ? t('admin_embed_all_indexed') : t('admin_embed_index_now', { count: coverage?.stale ?? 0 })}
            </Button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-text-main/60">{t('admin_embed_corpus_coverage')}</span>
            <span className="font-mono text-text-main/70">
              {coverage ? `${coverage.indexed} / ${coverage.totalDocs}` : '—'}{' '}
              <span className="text-text-main/60">({pct}%)</span>
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-border-subtle overflow-hidden">
            <div className="h-full rounded-full bg-brand-soft transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
          {[
            { label: t('admin_embed_stat_indexed'), value: coverage ? String(coverage.indexed) : '—' },
            { label: t('admin_embed_stat_pending'), value: coverage ? String(coverage.stale) : '—' },
            { label: t('admin_embed_stat_unsynced'), value: coverage ? String(coverage.unsynced) : '—' },
            { label: t('admin_embed_stat_model_dim'), value: coverage ? `${coverage.model.split('/').pop()} · ${coverage.dim}` : '—' },
            { label: t('admin_embed_stat_latest'), value: coverage?.lastProcessedAt ? new Date(coverage.lastProcessedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—' },
          ].map(s => (
            <div key={s.label} className="p-2.5 rounded-xl border border-border-subtle/60 bg-surface-base/5">
              <div className="text-[9px] uppercase tracking-wider text-text-main/60 font-bold">{s.label}</div>
              <div className="text-text-main/80 font-mono mt-0.5 truncate" title={s.value}>{s.value}</div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-text-main/60">
          {t('admin_embed_footer_desc')}
        </p>
      </div>

      {/* Test search card */}
      <div className="p-5 rounded-2xl border border-border-subtle bg-surface-base/5 space-y-3">
        <h3 className="text-sm font-semibold text-text-main flex items-center gap-2">
          <Search size={15} className="text-brand-soft" />
          {t('admin_embed_test_search_title')}
        </h3>
        <div className="flex items-center gap-2">
          <Input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void handleSearch(); }}
            placeholder={t('admin_embed_test_search_placeholder')}
            className="flex-1 px-3 py-2 text-xs rounded-xl bg-surface-base/5 border border-border-subtle text-text-main outline-none placeholder:text-text-main/40"
          />
          <Button
            onClick={() => void handleSearch()}
            disabled={searching || !query.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-text-main text-surface-base text-xs font-semibold disabled:opacity-50 transition-colors min-h-[36px]"
          >
            {searching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
            {t('admin_embed_test_search_btn')}
          </Button>
        </div>

        {results !== null && (
          results.length === 0 ? (
            <p className="text-xs text-text-main/60 italic py-2">{t('admin_embed_test_search_empty')}</p>
          ) : (
            <div className="space-y-2">
              {results.map((r, i) => (
                <div key={r.documentId} className="p-3 rounded-xl border border-border-subtle/60 bg-surface-base/5">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-semibold text-text-main/80 truncate">
                      {i + 1}. {r.title || t('common_untitled')}
                    </span>
                    <span className={cn(
                      "text-[10px] font-mono px-2 py-0.5 rounded-full shrink-0",
                      r.score >= 0.5 ? "bg-brand-soft/10 text-brand-soft" : "bg-surface-base/10 text-text-main/60"
                    )}>
                      {r.score.toFixed(3)}
                    </span>
                  </div>
                  <p className="text-[11px] text-text-main/60 line-clamp-2">{r.content.slice(0, 240) || '(пусто)'}</p>
                </div>
              ))}
            </div>
          )
        )}
        <p className="text-[10px] text-text-main/60">
          {t('admin_embed_test_search_footer')}
        </p>
      </div>
    </div>
  );
}
