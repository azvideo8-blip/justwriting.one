import { useState, useEffect, useCallback } from 'react';
import { Loader2, RefreshCw, Sparkles, Search, CloudUpload, RotateCcw } from 'lucide-react';
import { cn } from '../../../core/utils/utils';
import { Button } from '../../../shared/components/Button';
import { Input } from '../../../shared/components/Input';
import { useToast } from '../../../shared/components/Toast';
import { getIndexCoverage, indexPending, reindexAll, type IndexCoverage } from '../utils/embeddingIndexer';
import { searchNotes, type RetrievedNote } from '../utils/noteRetriever';
import { AIEmbeddingService } from '../services/AIEmbeddingService';

export function EmbeddingDiagnostics() {
  const { showToast } = useToast();
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
      console.error('[EmbeddingDiagnostics] coverage failed:', e);
      showToast('Не удалось загрузить статус индексации', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleIndexNow = async () => {
    setIndexing(true);
    setProgress({ done: 0, total: coverage?.stale ?? 0 });
    try {
      const summary = await indexPending({
        onProgress: (done, total) => setProgress({ done, total }),
      });
      if (summary.stopped === 'daily') showToast('Индексация приостановлена: дневной лимит ИИ', 'error');
      else if (summary.stopped === 'rate') showToast('Индексация приостановлена: слишком много запросов', 'error');
      else showToast(`Индексация: +${summary.ok} новых, ${summary.skipped} пропущено, ${summary.failed} ошибок`, 'success');
    } catch (e) {
      console.error('[EmbeddingDiagnostics] index failed:', e);
      showToast('Ошибка индексации', 'error');
    } finally {
      setIndexing(false);
      setProgress(null);
      void refresh();
    }
  };

  const handleReindexAll = async () => {
    const total = coverage?.totalDocs ?? 0;
    if (!window.confirm(`Переиндексировать ВСЕ заметки (${total})? Каждая будет пересчитана заново — это потратит лимит ИИ. Нужно при смене алгоритма/модели или для подстраховки.`)) return;
    setReindexing(true);
    setProgress({ done: 0, total });
    try {
      const summary = await reindexAll({ onProgress: (done, t) => setProgress({ done, total: t }) });
      if (summary.stopped === 'daily') showToast('Переиндексация приостановлена: дневной лимит ИИ', 'error');
      else if (summary.stopped === 'rate') showToast('Переиндексация приостановлена: слишком много запросов', 'error');
      else showToast(`Переиндексировано: ${summary.ok}, пропущено ${summary.skipped}, ошибок ${summary.failed}`, 'success');
    } catch (e) {
      console.error('[EmbeddingDiagnostics] reindex failed:', e);
      showToast('Ошибка переиндексации', 'error');
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
      if (r.locked) showToast(`Синхронизировано ${r.synced}; остальное ждёт — разблокируй E2E-шифрование`, 'error');
      else if (r.synced > 0) showToast(`В облако выгружено эмбеддингов: ${r.synced}`, 'success');
      else showToast('Всё уже синхронизировано', 'success');
    } catch (e) {
      console.error('[EmbeddingDiagnostics] sync failed:', e);
      showToast('Ошибка синхронизации', 'error');
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
      console.error('[EmbeddingDiagnostics] search failed:', e);
      showToast('Ошибка поиска', 'error');
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
            Эмбеддинги заметок (семантический поиск)
          </h3>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => void refresh()}
              disabled={loading || indexing || reindexing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border-subtle bg-surface-base/5 text-text-main/60 text-xs font-semibold disabled:opacity-50 transition-colors"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Обновить
            </Button>
            <Button
              onClick={() => void handleSync()}
              disabled={syncing || indexing || reindexing || loading || (coverage?.unsynced ?? 0) === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border-subtle bg-surface-base/5 text-text-main/60 text-xs font-semibold disabled:opacity-50 transition-colors min-h-[34px]"
            >
              {syncing ? <Loader2 size={12} className="animate-spin" /> : <CloudUpload size={12} />}
              {(coverage?.unsynced ?? 0) === 0 ? 'В облаке' : `В облако (${coverage?.unsynced ?? 0})`}
            </Button>
            <Button
              onClick={() => void handleReindexAll()}
              disabled={indexing || reindexing || loading || (coverage?.totalDocs ?? 0) === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border-subtle bg-surface-base/5 text-text-main/60 text-xs font-semibold disabled:opacity-50 transition-colors min-h-[34px]"
            >
              {reindexing ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
              {reindexing && progress ? `Пересчёт ${progress.done}/${progress.total}…` : 'Переиндексировать всё'}
            </Button>
            <Button
              onClick={() => void handleIndexNow()}
              disabled={indexing || reindexing || loading || (coverage?.stale ?? 0) === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-text-main text-surface-base text-xs font-semibold disabled:opacity-50 transition-colors min-h-[34px]"
            >
              {indexing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {indexing && progress
                ? `Индексация ${progress.done}/${progress.total}…`
                : (coverage?.stale ?? 0) === 0 ? 'Всё проиндексировано' : `Индексировать сейчас (${coverage?.stale ?? 0})`}
            </Button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-text-main/50">Покрытие корпуса</span>
            <span className="font-mono text-text-main/70">
              {coverage ? `${coverage.indexed} / ${coverage.totalDocs}` : '—'}{' '}
              <span className="text-text-main/40">({pct}%)</span>
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-border-subtle overflow-hidden">
            <div className="h-full rounded-full bg-brand-soft transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
          {[
            { label: 'Проиндексировано', value: coverage ? String(coverage.indexed) : '—' },
            { label: 'Ожидают', value: coverage ? String(coverage.stale) : '—' },
            { label: 'Не в облаке', value: coverage ? String(coverage.unsynced) : '—' },
            { label: 'Модель / размер', value: coverage ? `${coverage.model.split('/').pop()} · ${coverage.dim}` : '—' },
            { label: 'Последняя', value: coverage?.lastProcessedAt ? new Date(coverage.lastProcessedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—' },
          ].map(s => (
            <div key={s.label} className="p-2.5 rounded-xl border border-border-subtle/60 bg-surface-base/5">
              <div className="text-[9px] uppercase tracking-wider text-text-main/40 font-bold">{s.label}</div>
              <div className="text-text-main/80 font-mono mt-0.5 truncate" title={s.value}>{s.value}</div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-text-main/30">
          Индексация идёт автоматически в фоне при простое. Кнопка выше форсирует прогон сейчас. Каждый прогон тратит лимит ИИ (по одному эмбеддингу на заметку).
        </p>
      </div>

      {/* Test search card */}
      <div className="p-5 rounded-2xl border border-border-subtle bg-surface-base/5 space-y-3">
        <h3 className="text-sm font-semibold text-text-main flex items-center gap-2">
          <Search size={15} className="text-brand-soft" />
          Тестовый поиск по заметкам
        </h3>
        <div className="flex items-center gap-2">
          <Input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void handleSearch(); }}
            placeholder="напр.: что я писал про отцовство и усталость"
            className="flex-1 px-3 py-2 text-xs rounded-xl bg-surface-base/5 border border-border-subtle text-text-main outline-none placeholder:text-text-main/30"
          />
          <Button
            onClick={() => void handleSearch()}
            disabled={searching || !query.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-text-main text-surface-base text-xs font-semibold disabled:opacity-50 transition-colors min-h-[36px]"
          >
            {searching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
            Найти
          </Button>
        </div>

        {results !== null && (
          results.length === 0 ? (
            <p className="text-xs text-text-main/30 italic py-2">Ничего не найдено (нет проиндексированных заметок или совпадений)</p>
          ) : (
            <div className="space-y-2">
              {results.map((r, i) => (
                <div key={r.documentId} className="p-3 rounded-xl border border-border-subtle/60 bg-surface-base/5">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-semibold text-text-main/80 truncate">
                      {i + 1}. {r.title || 'Без названия'}
                    </span>
                    <span className={cn(
                      "text-[10px] font-mono px-2 py-0.5 rounded-full shrink-0",
                      r.score >= 0.5 ? "bg-brand-soft/10 text-brand-soft" : "bg-surface-base/10 text-text-main/40"
                    )}>
                      {r.score.toFixed(3)}
                    </span>
                  </div>
                  <p className="text-[11px] text-text-main/50 line-clamp-2">{r.content.slice(0, 240) || '(пусто)'}</p>
                </div>
              ))}
            </div>
          )
        )}
        <p className="text-[10px] text-text-main/30">
          Эмбеддит запрос → косинус по локальным векторам → LLM-рерэнк по саммари → топ-5. Так это работает в чате при запросах «что я писал про…».
        </p>
      </div>
    </div>
  );
}
