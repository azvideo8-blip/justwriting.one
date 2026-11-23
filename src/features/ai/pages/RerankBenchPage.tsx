import { useState, useEffect, useCallback } from 'react';
import { Loader2, Play, Copy, Check, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { searchNotes, type RetrievedNote } from '../utils/noteRetriever';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { Button } from '../../../shared/components/Button';
import { useToast } from '../../../shared/components/Toast';
import { getIndexingConsent } from '../../../core/ai/indexingConsent';
import { getCurrentUser } from '../../../core/auth';
import { useLanguage } from '../../../shared/i18n';
import { reportError } from '../../../shared/errors/reportError';

// Оценка сохраняется после каждого нажатия. В прошлый заход случайный жест
// «назад» на тачпаде стёр час работы — здесь этого не повторится.
const STORAGE_KEY = 'rerank_bench_state_v1';

type Verdict = 'hit' | 'similar' | 'miss';

const VERDICT_WEIGHT: Record<Verdict, number> = { hit: 1, similar: 0.5, miss: 0 };

interface NoteMeta {
  title: string;
  date?: number | undefined;
  excerpt: string;
}

interface QueryRun {
  query: string;
  rrfTop5: string[];
  rerankTop5: string[];
  judged: string[];
  meta: Record<string, NoteMeta>;
  verdicts: Record<string, Verdict>;
  bypassed: boolean;
  bypassReason?: string | undefined;
  rerankFailed?: boolean | undefined;
  rerankLatencyMs?: number | undefined;
}

interface BenchState {
  queriesText: string;
  runs: QueryRun[];
  startedAt: number;
}

function loadState(): BenchState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as BenchState) : null;
  } catch {
    return null;
  }
}

function saveState(state: BenchState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* намеренно: переполнение хранилища не должно ронять оценку */ }
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Вес выдачи и позиция первого попадания. */
function scoreOrdering(ids: string[], verdicts: Record<string, Verdict>) {
  if (ids.length === 0) return { precision: 0, mrr: 0, weight: 0 };
  const weight = ids.reduce((s, id) => s + (VERDICT_WEIGHT[verdicts[id] ?? 'miss'] ?? 0), 0);
  const firstHit = ids.findIndex(id => verdicts[id] === 'hit');
  return { precision: weight / ids.length, mrr: firstHit === -1 ? 0 : 1 / (firstHit + 1), weight };
}

export function RerankBenchPage() {
  const { showToast } = useToast();
  const { t } = useLanguage();
  const [state, setState] = useState<BenchState | null>(() => loadState());
  const [queriesText, setQueriesText] = useState(() => loadState()?.queriesText ?? '');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, string>>({});

  useEffect(() => {
    if (state) saveState(state);
  }, [state]);

  const setVerdict = useCallback((qi: number, docId: string, verdict: Verdict) => {
    setState(prev => {
      if (!prev) return prev;
      const runs = [...prev.runs];
      const run = runs[qi]!;
      runs[qi] = { ...run, verdicts: { ...run.verdicts, [docId]: verdict } };
      return { ...prev, runs };
    });
  }, []);

  const toggleFull = useCallback(async (docId: string) => {
    setExpanded(prev => {
      if (prev[docId] !== undefined) {
        const next = { ...prev };
        delete next[docId];
        return next;
      }
      return { ...prev, [docId]: '' };
    });
    const already = expanded[docId];
    if (already === undefined) {
      // NB-17 №17: отказ чтения назван строкой, а не необработанным промисом.
      try {
        const text = await LocalVersionService.getLatestContent(docId);
        setExpanded(prev => (docId in prev ? { ...prev, [docId]: text || '(текст не найден)' } : prev));
      } catch (e) {
        reportError(e, { action: 'rerank_bench_full_text', docId });
        setExpanded(prev => (docId in prev ? { ...prev, [docId]: t('admin_full_text_load_error') } : prev));
      }
    }
  }, [expanded, t]);

  const run = async () => {
    const list = queriesText.split('\n').map(s => s.trim()).filter(Boolean);
    if (list.length === 0) { showToast('Введите хотя бы один запрос', 'error'); return; }
    if (getIndexingConsent(getCurrentUser()?.uid) !== 'granted') {
      showToast('Поиск по смыслу выключен: оба пути вернут одно и то же. Включите его в настройках', 'error');
      return;
    }

    setRunning(true);
    setProgress(0);
    const runs: QueryRun[] = [];
    try {
      for (let i = 0; i < list.length; i++) {
        const query = list[i]!;
        setProgress(i + 1);

        const rrfNotes = await searchNotes(query, 5, { skipRerank: true });
        let meta: { bypassed: boolean; bypassReason?: string; rerankLatencyMs?: number; rerankFailed?: boolean } = { bypassed: false };
        const rerankNotes = await searchNotes(query, 5, {
          skipRerank: false,
          onRerankMeta: m => { meta = m; },
        });

        const byId: Record<string, NoteMeta> = {};
        const add = (n: RetrievedNote) => {
          byId[n.documentId] = {
            title: n.title,
            date: n.lastSessionAt,
            excerpt: n.content.slice(0, 500),
          };
        };
        rrfNotes.forEach(add);
        rerankNotes.forEach(add);

        const union = [...new Set([...rrfNotes, ...rerankNotes].map(n => n.documentId))];
        runs.push({
          query,
          rrfTop5: rrfNotes.map(n => n.documentId),
          rerankTop5: rerankNotes.map(n => n.documentId),
          judged: shuffle(union),
          meta: byId,
          verdicts: {},
          bypassed: meta.bypassed,
          bypassReason: meta.bypassReason,
          rerankFailed: meta.rerankFailed,
          rerankLatencyMs: meta.rerankLatencyMs,
        });
        // Промежуточное сохранение: длинный прогон не должен пропадать целиком.
        setState({ queriesText, runs: [...runs], startedAt: Date.now() });
      }
      // Реранкер отказал хоть раз — прогон не чистый: не зелёным.
      showToast(`Прогон завершён: ${runs.length} запросов`, runs.some(r => r.rerankFailed) ? 'warning' : 'success');
    } catch (e) {
      console.error(e);
      showToast('Ошибка при прогоне', 'error');
    } finally {
      setRunning(false);
    }
  };

  const runs = state?.runs ?? [];
  const totalPairs = runs.reduce((s, r) => s + r.judged.length, 0);
  const judgedPairs = runs.reduce((s, r) => s + Object.keys(r.verdicts).length, 0);

  let scored = 0, aP = 0, bP = 0, aM = 0, bM = 0, aW = 0, bW = 0, win = 0, lose = 0, tie = 0;
  const bypassReasons = new Map<string, number>();
  let failedCount = 0;
  for (const r of runs) {
    if (r.bypassed) bypassReasons.set(r.bypassReason ?? 'без причины', (bypassReasons.get(r.bypassReason ?? 'без причины') ?? 0) + 1);
    if (r.rerankFailed) failedCount++;
    // В счёт идут только запросы, где есть оценки, выдачи разошлись и реранк отработал.
    const identical = r.rrfTop5.join(',') === r.rerankTop5.join(',');
    if (Object.keys(r.verdicts).length === 0 || identical || r.rerankFailed) continue;
    const a = scoreOrdering(r.rrfTop5, r.verdicts);
    const b = scoreOrdering(r.rerankTop5, r.verdicts);
    scored++; aP += a.precision; bP += b.precision; aM += a.mrr; bM += b.mrr; aW += a.weight; bW += b.weight;
    const sa = a.precision + a.mrr, sb = b.precision + b.mrr;
    if (sb > sa + 0.01) win++; else if (sa > sb + 0.01) lose++; else tie++;
  }
  const pc = (v: number) => (scored > 0 ? Math.round((v / scored) * 100) : 0);
  const mr = (v: number) => (scored > 0 ? (v / scored).toFixed(2) : '—');

  const report = [
    '### Замер вклада реранка (AI-2)',
    '',
    '| Показатель | Значение |',
    '|---|---|',
    `| Всего запросов | ${runs.length} |`,
    `| Оценено пар «запрос — заметка» | ${judgedPairs} из ${totalPairs} |`,
    `| Запросов в зачёте | ${scored} |`,
    `| Обход сработал | ${runs.filter(r => r.bypassed).length} из ${runs.length} |`,
    `| Причины обхода | ${bypassReasons.size ? [...bypassReasons].map(([k, v]) => `${k}: ${v}`).join(', ') : '—'} |`,
    `| Вызов реранка не удался | ${failedCount} |`,
    `| Средняя точность: RRF / реранк | ${pc(aP)}% / ${pc(bP)}% |`,
    `| Средний MRR: RRF / реранк | ${mr(aM)} / ${mr(bM)} |`,
    `| Суммарный вес найденного: RRF / реранк | ${aW.toFixed(1)} / ${bW.toFixed(1)} |`,
    `| Реранк лучше / хуже / так же | ${win} / ${lose} / ${tie} |`,
    '',
    '*Попадание = 1, нашёл похожее = 0,5, не попал = 0. Тексты заметок и запросы в отчёт не входят.*',
  ].join('\n');

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-text-main">{t('admin_bench_title')}</h1>
        <p className="text-xs text-text-main/60 mt-1">
          {t('admin_bench_desc')}
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-text-main/70">{t('admin_bench_queries_label')}</label>
        <textarea
          value={queriesText}
          onChange={e => setQueriesText(e.target.value)}
          rows={10}
          disabled={running}
          placeholder={t('admin_bench_queries_placeholder')}
          className="w-full p-3 text-xs rounded-xl bg-surface-base/5 border border-border-subtle text-text-main outline-none placeholder:text-text-main/40 font-mono leading-relaxed"
        />
        <div className="flex items-center gap-2">
          <Button
            onClick={() => void run()}
            disabled={running}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-soft text-surface-base text-sm font-medium disabled:opacity-50"
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {running ? t('admin_bench_running_q', { count: progress }) : t('admin_bench_run')}
          </Button>
          {runs.length > 0 && (
            <Button
              onClick={() => {
                if (!confirm('Стереть результаты и оценки?')) return;
                localStorage.removeItem(STORAGE_KEY);
                setState(null);
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border-subtle text-xs text-text-main/60 hover:text-text-main"
            >
              <RotateCcw size={12} /> {t('admin_bench_restart')}
            </Button>
          )}
        </div>
      </div>

      {runs.length > 0 && (
        <>
          <div className="p-4 rounded-xl border border-border-subtle bg-surface-card space-y-3 sticky top-2 z-10 backdrop-blur">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-text-main">
                {t('admin_bench_judged_of', { judged: judgedPairs, total: totalPairs })}
              </span>
              <Button
                onClick={() => {
                  // «Скопирована» — только когда буфер принял текст.
                  // Без буфера (не https) writeText — undefined: ошибка, а не бросок из обработчика.
                  Promise.resolve().then(() => navigator.clipboard.writeText(report)).then(() => {
                    setCopied(true);
                    showToast('Сводка скопирована', 'success');
                    setTimeout(() => setCopied(false), 2000);
                  }, () => showToast(t('archive_copy_failed'), 'error'));
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-subtle text-xs text-text-main/70 hover:text-text-main"
              >
                {copied ? <Check size={12} className="text-accent-success" /> : <Copy size={12} />}
                {t('admin_bench_copy')}
              </Button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
              <div className="p-2 rounded-lg bg-surface-base/10 border border-border-subtle/50">
                <div className="text-text-main/50 text-[10px]">{t('admin_bench_in_count')}</div>
                <div className="font-semibold text-text-main mt-0.5">{t('admin_bench_scored_of', { scored, total: runs.length })}</div>
              </div>
              <div className="p-2 rounded-lg bg-surface-base/10 border border-border-subtle/50">
                <div className="text-text-main/50 text-[10px]">{t('admin_bench_precision')}</div>
                <div className="font-semibold text-text-main mt-0.5">{pc(aP)}% / {pc(bP)}%</div>
              </div>
              <div className="p-2 rounded-lg bg-surface-base/10 border border-border-subtle/50">
                <div className="text-text-main/50 text-[10px]">{t('admin_bench_mrr')}</div>
                <div className="font-semibold text-text-main mt-0.5">{mr(aM)} / {mr(bM)}</div>
              </div>
              <div className="p-2 rounded-lg bg-surface-base/10 border border-border-subtle/50">
                <div className="text-text-main/50 text-[10px]">{t('admin_bench_winloss')}</div>
                <div className="font-semibold text-text-main mt-0.5">{win} / {lose} / {tie}</div>
              </div>
            </div>
          </div>

          <div className="space-y-5">
            {runs.map((r, qi) => {
              const left = r.judged.length - Object.keys(r.verdicts).length;
              return (
                <div key={qi} className={`p-4 rounded-xl border space-y-3 ${left === 0 ? 'border-border-subtle bg-surface-base/5' : 'border-brand-soft/40 bg-brand-soft/5'}`}>
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <span className="text-sm font-semibold text-text-main">
                      {qi + 1}. «{r.query}»
                    </span>
                    <span className="flex items-center gap-2">
                      {r.bypassed && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-surface-base/20 text-text-main/60 font-mono">
                          {t('admin_bench_bypassed', { reason: r.bypassReason ?? t('admin_bench_bypass_default') })}
                        </span>
                      )}
                      {r.rerankFailed && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-accent-danger/15 text-accent-danger font-mono">
                          {t('admin_bench_rerank_failed')}
                        </span>
                      )}
                      <span className="text-[10px] text-text-main/40">
                        {left === 0 ? t('admin_bench_done') : t('admin_bench_left', { count: left })}
                      </span>
                    </span>
                  </div>

                  {r.judged.map(docId => {
                    const m = r.meta[docId];
                    const v = r.verdicts[docId];
                    const isOpen = docId in expanded;
                    return (
                      <div
                        key={docId}
                        className={`p-3 rounded-xl border text-xs space-y-2 ${
                          v === 'hit' ? 'border-accent-success/40 bg-accent-success/5'
                          : v === 'similar' ? 'border-accent-warning/40 bg-accent-warning/5'
                          : v === 'miss' ? 'border-border-subtle bg-surface-base/5 opacity-60'
                          : 'border-border-subtle bg-surface-card'
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="font-medium text-text-main/90">{m?.title || t('admin_unnamed')}</span>
                          {m?.date && (
                            <span className="text-[10px] text-text-main/40 shrink-0 font-mono">
                              {new Date(m.date).toLocaleDateString()}
                            </span>
                          )}
                        </div>

                        <div className="text-[11px] text-text-main/70 leading-relaxed whitespace-pre-wrap">
                          {isOpen && expanded[docId] ? expanded[docId] : m?.excerpt}
                        </div>

                        <button
                          type="button"
                          onClick={() => { void toggleFull(docId); }}
                          className="flex items-center gap-1 text-[11px] text-text-main/50 hover:text-text-main"
                        >
                          {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          {isOpen ? t('admin_collapse') : t('admin_read_full')}
                        </button>

                        <div className="flex items-center gap-2 flex-wrap">
                          {([['hit', t('admin_verdict_hit')], ['similar', t('admin_verdict_similar')], ['miss', t('admin_verdict_miss')]] as [Verdict, string][]).map(([key, label]) => (
                            <Button
                              key={key}
                              onClick={() => setVerdict(qi, docId, key)}
                              className={`px-3 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                                v === key
                                  ? key === 'hit' ? 'bg-accent-success text-white border-accent-success'
                                    : key === 'similar' ? 'bg-accent-warning text-white border-accent-warning'
                                    : 'bg-text-main text-surface-base border-text-main'
                                  : 'border-border-subtle text-text-main/70 hover:bg-surface-base/10'
                              }`}
                            >
                              {label}
                            </Button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
