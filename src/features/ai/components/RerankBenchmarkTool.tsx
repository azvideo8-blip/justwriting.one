import { useState } from 'react';
import { Loader2, Play, CheckCircle, Scale, Copy, Check } from 'lucide-react';
import { searchNotes, type RetrievedNote } from '../utils/noteRetriever';
import { getIndexingConsent } from '../../../core/ai/indexingConsent';
import { getCurrentUser } from '../../../core/auth';
import { Button } from '../../../shared/components/Button';
import { useToast } from '../../../shared/components/Toast';

const DEFAULT_QUERIES = [
  '[запрос удалён]',
  '[запрос удалён]',
  '[запрос удалён]',
  '[запрос удалён]',
  '[запрос удалён]',
  '[запрос удалён]',
  '[запрос удалён]',
  '[запрос удалён]',
  '[запрос удалён]',
  '[запрос удалён]',
  '[запрос удалён]',
  '[запрос удалён]',
  '[запрос удалён]',
  '[запрос удалён]',
  '[запрос удалён]',
  '[запрос удалён]',
];

interface QueryBenchResult {
  query: string;
  rrfNotes: RetrievedNote[];
  rerankNotes: RetrievedNote[];
  isIdentical: boolean;
  bypassed: boolean;
  bypassReason?: string | undefined;
  rerankFailed?: boolean | undefined;
  rerankLatencyMs?: number | undefined;
  // Blind presentation
  option1IsRerank: boolean;
  option1Notes: RetrievedNote[];
  option2Notes: RetrievedNote[];
  // Оценка по существу: объединение обоих списков в перемешанном порядке.
  // Сравнивать два порядка одних и тех же пяти заметок человек не может —
  // особенно по строке в сто знаков. Отметить «по теме / не по теме» он может
  // всегда, а какой порядок поднял нужное выше, посчитает машина.
  judged: RetrievedNote[];
  relevant: Record<string, boolean>;
}

/** Перемешивание, чтобы порядок в списке для оценки ничего не подсказывал. */
function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Доля нужных заметок в выдаче и позиция первой нужной. */
function scoreOrdering(notes: RetrievedNote[], relevant: Record<string, boolean>) {
  const hits = notes.filter(n => relevant[n.documentId]).length;
  const firstHit = notes.findIndex(n => relevant[n.documentId]);
  return {
    precision: notes.length > 0 ? hits / notes.length : 0,
    mrr: firstHit === -1 ? 0 : 1 / (firstHit + 1),
    hits,
  };
}

export function RerankBenchmarkTool() {
  const { showToast } = useToast();
  const [queriesText, setQueriesText] = useState(DEFAULT_QUERIES.join('\n'));
  const [running, setRunning] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [benchResults, setBenchResults] = useState<QueryBenchResult[] | null>(null);
  const [copied, setCopied] = useState(false);

  const runBenchmark = async () => {
    const list = queriesText
      .split('\n')
      .map(q => q.trim())
      .filter(q => q.length > 0);

    if (list.length === 0) {
      showToast('Введите хотя бы один запрос', 'error');
      return;
    }

    // Без согласия на индексацию searchNotes выходит до векторного поиска и
    // отдаёт выдачу по словам. Оба пути тогда возвращают одно и то же, обход
    // считается на всех запросах, задержка выходит нулевой — и сводка выглядит
    // убедительным доказательством того, что реранк не нужен. На самом деле
    // сравнивался поиск по словам сам с собой. Так и произошло 21 августа.
    if (getIndexingConsent(getCurrentUser()?.uid) !== 'granted') {
      showToast(
        'Поиск по смыслу выключен: без него сравнивать нечего — оба пути вернут одно и то же. Включите его в настройках и повторите',
        'error',
      );
      return;
    }

    setRunning(true);
    setCurrentIndex(0);
    const results: QueryBenchResult[] = [];

    try {
      for (let i = 0; i < list.length; i++) {
        setCurrentIndex(i + 1);
        const query = list[i]!;

        const rrfNotes = await searchNotes(query, 5, { skipRerank: true });

        let rerankMeta: { bypassed: boolean; bypassReason?: string; rerankLatencyMs?: number; rerankFailed?: boolean } = { bypassed: false };
        const rerankNotes = await searchNotes(query, 5, {
          skipRerank: false,
          onRerankMeta: m => { rerankMeta = m; },
        });

        const rrfIds = rrfNotes.map(n => n.documentId).join(',');
        const rerankIds = rerankNotes.map(n => n.documentId).join(',');
        const isIdentical = rrfIds === rerankIds;

        // Coin flip for blinding
        const option1IsRerank = Math.random() < 0.5;

        results.push({
          query,
          rrfNotes,
          rerankNotes,
          isIdentical,
          bypassed: rerankMeta.bypassed,
          bypassReason: rerankMeta.bypassReason,
          rerankFailed: rerankMeta.rerankFailed,
          judged: shuffle(
            [...rrfNotes, ...rerankNotes].filter(
              (n, i, arr) => arr.findIndex(x => x.documentId === n.documentId) === i,
            ),
          ),
          relevant: {},
          rerankLatencyMs: rerankMeta.rerankLatencyMs,
          option1IsRerank,
          option1Notes: option1IsRerank ? rerankNotes : rrfNotes,
          option2Notes: option1IsRerank ? rrfNotes : rerankNotes,
        });

        // Small pause to yield UI
        await new Promise(r => setTimeout(r, 100));
      }

      setBenchResults(results);
      showToast(`Замер завершён: ${results.length} запросов`, 'success');
    } catch (e) {
      console.error(e);
      showToast('Ошибка при выполнении замера', 'error');
    } finally {
      setRunning(false);
    }
  };

  const handleRelevance = (index: number, documentId: string, value: boolean) => {
    if (!benchResults) return;
    const updated = [...benchResults];
    const row = updated[index]!;
    updated[index] = { ...row, relevant: { ...row.relevant, [documentId]: value } };
    setBenchResults(updated);
  };

  // Compute stats
  const total = benchResults?.length ?? 0;
  const reviewed = benchResults?.filter(r => Object.keys(r.relevant).length > 0).length ?? 0;
  const bypassedCount = benchResults?.filter(r => r.bypassed).length ?? 0;
  const bypassPct = total > 0 ? Math.round((bypassedCount / total) * 100) : 0;

  const latencies = benchResults?.filter(r => !r.bypassed && r.rerankLatencyMs !== undefined).map(r => r.rerankLatencyMs!) ?? [];
  const avgLatency = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;

  // Считаем не голоса, а качество порядка: доля нужных заметок в пятёрке и
  // позиция первой нужной. Человек отмечает «по теме», арифметику делает машина —
  // сравнивать на глаз два порядка одних и тех же пяти заметок он не может.
  let rerankWins = 0;
  let rrfWins = 0;
  let sames = 0;
  let rrfPrecisionSum = 0;
  let rerankPrecisionSum = 0;
  let rrfMrrSum = 0;
  let rerankMrrSum = 0;
  let scoredQueries = 0;

  benchResults?.forEach(r => {
    // Считаются только запросы, где человек что-то отметил и где реранк
    // действительно вызывался: на совпавших выдачах и на неудачных вызовах
    // сравнивать нечего.
    if (Object.keys(r.relevant).length === 0 || r.isIdentical || r.rerankFailed) return;
    const a = scoreOrdering(r.rrfNotes, r.relevant);
    const b = scoreOrdering(r.rerankNotes, r.relevant);
    scoredQueries++;
    rrfPrecisionSum += a.precision;
    rerankPrecisionSum += b.precision;
    rrfMrrSum += a.mrr;
    rerankMrrSum += b.mrr;
    const aScore = a.precision + a.mrr;
    const bScore = b.precision + b.mrr;
    if (bScore > aScore) rerankWins++;
    else if (aScore > bScore) rrfWins++;
    else sames++;
  });

  const pct = (v: number) => (scoredQueries > 0 ? Math.round((v / scoredQueries) * 100) : 0);
  const rrfPrecision = pct(rrfPrecisionSum);
  const rerankPrecision = pct(rerankPrecisionSum);
  const rrfMrr = scoredQueries > 0 ? (rrfMrrSum / scoredQueries).toFixed(2) : '—';
  const rerankMrr = scoredQueries > 0 ? (rerankMrrSum / scoredQueries).toFixed(2) : '—';

  // Причины разбиваются поимённо не для полноты: «сработал обход» без причины
  // одинаково выглядит и когда локального сигнала хватило, и когда поиск по
  // смыслу был просто выключен. Это разные выводы с противоположными
  // последствиями.
  const bypassReasonCounts = new Map<string, number>();
  (benchResults ?? []).forEach(r => {
    if (!r.bypassed) return;
    const reason = r.bypassReason ?? 'без причины';
    bypassReasonCounts.set(reason, (bypassReasonCounts.get(reason) ?? 0) + 1);
  });
  // Неудачный вызов реранка возвращает тот же порядок RRF, что и путь А.
  // Такие запросы нельзя считать «совпало»: сравнивать было нечего. Чаще всего
  // причина — исчерпанная дневная квота (bulk, 50 вызовов), и без этой строки
  // замер выглядит доказательством того, что реранк ничего не меняет.
  const failedRerankCount = (benchResults ?? []).filter(r => r.rerankFailed).length;
  const bypassReasonSummary = bypassReasonCounts.size === 0
    ? '—'
    : [...bypassReasonCounts.entries()].map(([k, v]) => `${k}: ${v}`).join(', ');

  const generateReportMarkdown = () => {
    return [
      `### Сводные числа замера реранкера (AI-2)`,
      ``,
      `| Метрика | Значение |`,
      `|---|---|`,
      `| Всего запросов | ${total} |`,
      `| Оценено владельцем | ${reviewed} из ${total} |`,
      `| Срабатывание байпаса (без вызова облака) | ${bypassedCount} из ${total} (${bypassPct}%) |`,
      `| Причины байпаса | ${bypassReasonSummary} |`,
      `| Вызов реранка не удался (сравнивать было нечего) | ${failedRerankCount} |`,
      `| Запросов с оценкой (списки разошлись, реранк отработал) | ${scoredQueries} |`,
      `| Доля нужных в пятёрке: RRF / реранк | ${rrfPrecision}% / ${rerankPrecision}% |`,
      `| Позиция первой нужной (MRR): RRF / реранк | ${rrfMrr} / ${rerankMrr} |`,
      `| Реранк поставил лучше / хуже / так же | ${rerankWins} / ${rrfWins} / ${sames} |`,
      `| Средняя задержка реранка (когда вызывался) | ${avgLatency} мс |`,
      ``,
      `*Примечание: приватные тексты заметок и формулировки запросов исключены из публичного отчёта.*`,
    ].join('\n');
  };

  const copyReport = () => {
    const text = generateReportMarkdown();
    void navigator.clipboard.writeText(text);
    setCopied(true);
    showToast('Сводка скопирована в буфер обмена', 'success');
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="p-5 rounded-2xl border border-border-subtle bg-surface-base/5 space-y-4 mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-text-main flex items-center gap-2">
            <Scale size={15} className="text-brand-soft" />
            AI-2: Слепой замер вклада облачного реранкера
          </h3>
          <p className="text-xs text-text-main/60 mt-0.5">
            Сравнивает локальный RRF топ-5 против текущего конвейера (RRF топ-15 → облачный реранкер → топ-5) на вашем реальном архиве.
          </p>
        </div>
        <Button
          onClick={() => void runBenchmark()}
          disabled={running}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-soft text-white text-xs font-semibold hover:bg-brand-soft/90 disabled:opacity-50 transition-colors"
        >
          {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          {running ? `Замер (${currentIndex} из ${queriesText.split('\n').filter(Boolean).length})…` : 'Запустить слепой замер'}
        </Button>
      </div>

      {!benchResults && (
        <div className="space-y-2">
          <label className="text-[11px] font-medium text-text-main/60">
            Список запросов для замера (по одному на строку):
          </label>
          <textarea
            value={queriesText}
            onChange={e => setQueriesText(e.target.value)}
            disabled={running}
            rows={8}
            className="w-full p-3 text-xs rounded-xl bg-surface-base/5 border border-border-subtle text-text-main outline-none placeholder:text-text-main/40 font-mono leading-relaxed"
          />
        </div>
      )}

      {benchResults && (
        <div className="space-y-6">
          {/* Summary Box */}
          <div className="p-4 rounded-xl border border-border-subtle bg-surface-card space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-text-main">
                Прогресс слепой оценки: {reviewed} / {total}
              </span>
              <Button
                onClick={copyReport}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-subtle text-xs text-text-main/70 hover:text-text-main"
              >
                {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                Скопировать сводку
              </Button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
              <div className="p-2 rounded-lg bg-surface-base/10 border border-border-subtle/50">
                <div className="text-text-main/50 text-[10px]">Байпас сработал</div>
                <div className="font-semibold text-text-main mt-0.5">{bypassedCount} из {total} ({bypassPct}%)</div>
              </div>
              <div className="p-2 rounded-lg bg-surface-base/10 border border-border-subtle/50">
                <div className="text-text-main/50 text-[10px]">Средняя задержка реранка</div>
                <div className="font-semibold text-text-main mt-0.5">{avgLatency} мс</div>
              </div>
              <div className="p-2 rounded-lg bg-surface-base/10 border border-border-subtle/50">
                <div className="text-text-main/50 text-[10px]">Реранк лучше / хуже / так же</div>
                <div className="font-semibold text-text-main mt-0.5">{rerankWins} / {rrfWins} / {sames}</div>
              </div>
              <div className="p-2 rounded-lg bg-surface-base/10 border border-border-subtle/50">
                <div className="text-text-main/50 text-[10px]">Доля нужных: RRF / реранк</div>
                <div className="font-semibold text-text-main mt-0.5">{rrfPrecision}% / {rerankPrecision}%</div>
              </div>
            </div>
          </div>

          {/* Blind comparisons list */}
          <div className="space-y-4">
            {benchResults.map((res, i) => (
              <div
                key={i}
                className={`p-4 rounded-xl border transition-colors ${
                  Object.keys(res.relevant).length > 0
                    ? 'border-border-subtle bg-surface-base/5'
                    : 'border-brand-soft/40 bg-brand-soft/5 shadow-sm'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="text-xs font-semibold text-text-main">
                    Запрос {i + 1}: «{res.query}»
                  </div>
                  {res.bypassed && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-surface-base/20 text-text-main/60 font-mono">
                      байпас ({res.bypassReason ?? 'условие'})
                    </span>
                  )}
                </div>

                {res.isIdentical ? (
                  <div className="p-3 rounded-lg bg-surface-base/10 text-xs text-text-main/60 flex items-center gap-2">
                    <CheckCircle size={14} className="text-green-500 shrink-0" />
                    Выдачи обоих вариантов идентичны (список заметок и порядок совпали на 100%).
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="text-[11px] text-text-main/60">
                      Отметьте, какие заметки действительно относятся к запросу. Порядок здесь
                      случайный и ничего не подсказывает — какой из двух способов поставил нужные
                      выше, посчитается само.
                    </div>

                    {res.judged.map(n => {
                      const mark = res.relevant[n.documentId];
                      return (
                        <div
                          key={n.documentId}
                          className={`p-3 rounded-xl border text-xs space-y-2 ${
                            mark === true
                              ? 'border-green-500/40 bg-green-500/5'
                              : mark === false
                                ? 'border-border-subtle bg-surface-base/5 opacity-60'
                                : 'border-border-subtle bg-surface-card'
                          }`}
                        >
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="font-medium text-text-main/90">
                              {n.title || 'Без названия'}
                            </span>
                            {n.lastSessionAt && (
                              <span className="text-[10px] text-text-main/40 shrink-0 font-mono">
                                {new Date(n.lastSessionAt).toLocaleDateString()}
                              </span>
                            )}
                          </div>

                          <div className="text-[11px] text-text-main/70 leading-relaxed whitespace-pre-wrap">
                            {n.content.slice(0, 600)}
                            {n.content.length > 600 ? '…' : ''}
                          </div>

                          <div className="flex items-center gap-2">
                            <Button
                              onClick={() => handleRelevance(i, n.documentId, true)}
                              className={`px-3 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                                mark === true
                                  ? 'bg-green-600 text-white border-green-600'
                                  : 'border-border-subtle text-text-main hover:bg-surface-base/10'
                              }`}
                            >
                              По теме
                            </Button>
                            <Button
                              onClick={() => handleRelevance(i, n.documentId, false)}
                              className={`px-3 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                                mark === false
                                  ? 'bg-text-main text-surface-base border-text-main'
                                  : 'border-border-subtle text-text-main/70 hover:bg-surface-base/10'
                              }`}
                            >
                              Не по теме
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              onClick={() => setBenchResults(null)}
              className="px-3 py-1.5 rounded-xl border border-border-subtle text-xs text-text-main/60 hover:text-text-main"
            >
              Сбросить результаты и повторить
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
