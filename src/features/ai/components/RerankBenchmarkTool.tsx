import { useState } from 'react';
import { Loader2, Play, CheckCircle, Scale, Copy, Check } from 'lucide-react';
import { searchNotes, type RetrievedNote } from '../utils/noteRetriever';
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
  rerankLatencyMs?: number | undefined;
  // Blind presentation
  option1IsRerank: boolean;
  option1Notes: RetrievedNote[];
  option2Notes: RetrievedNote[];
  userChoice?: 'opt1' | 'opt2' | 'same' | undefined;
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

    setRunning(true);
    setCurrentIndex(0);
    const results: QueryBenchResult[] = [];

    try {
      for (let i = 0; i < list.length; i++) {
        setCurrentIndex(i + 1);
        const query = list[i]!;

        let rrfMeta: { bypassed: boolean; bypassReason?: string; rerankLatencyMs?: number } = { bypassed: true };
        const rrfNotes = await searchNotes(query, 5, {
          skipRerank: true,
          onRerankMeta: m => { rrfMeta = m; },
        });

        let rerankMeta: { bypassed: boolean; bypassReason?: string; rerankLatencyMs?: number } = { bypassed: false };
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
          rerankLatencyMs: rerankMeta.rerankLatencyMs,
          option1IsRerank,
          option1Notes: option1IsRerank ? rerankNotes : rrfNotes,
          option2Notes: option1IsRerank ? rrfNotes : rerankNotes,
          userChoice: isIdentical ? 'same' : undefined,
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

  const handleChoice = (index: number, choice: 'opt1' | 'opt2' | 'same') => {
    if (!benchResults) return;
    const updated = [...benchResults];
    updated[index] = { ...updated[index]!, userChoice: choice };
    setBenchResults(updated);
  };

  // Compute stats
  const total = benchResults?.length ?? 0;
  const reviewed = benchResults?.filter(r => r.userChoice !== undefined).length ?? 0;
  const bypassedCount = benchResults?.filter(r => r.bypassed).length ?? 0;
  const bypassPct = total > 0 ? Math.round((bypassedCount / total) * 100) : 0;

  const latencies = benchResults?.filter(r => !r.bypassed && r.rerankLatencyMs !== undefined).map(r => r.rerankLatencyMs!) ?? [];
  const avgLatency = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;

  let rerankWins = 0;
  let rrfWins = 0;
  let sames = 0;

  benchResults?.forEach(r => {
    if (r.userChoice === 'same') {
      sames++;
    } else if (r.userChoice === 'opt1') {
      if (r.option1IsRerank) rerankWins++;
      else rrfWins++;
    } else if (r.userChoice === 'opt2') {
      if (!r.option1IsRerank) rerankWins++;
      else rrfWins++;
    }
  });

  const generateReportMarkdown = () => {
    return [
      `### Сводные числа замера реранкера (AI-2)`,
      ``,
      `| Метрика | Значение |`,
      `|---|---|`,
      `| Всего запросов | ${total} |`,
      `| Оценено владельцем | ${reviewed} из ${total} |`,
      `| Срабатывание байпаса (без вызова облака) | ${bypassedCount} из ${total} (${bypassPct}%) |`,
      `| Выигрыш облачного реранкера (Rerank > RRF) | ${rerankWins} |`,
      `| Выигрыш локального RRF (RRF > Rerank) | ${rrfWins} |`,
      `| Одинаковое качество / совпадение списков | ${sames} |`,
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
                <div className="text-text-main/50 text-[10px]">Реранк лучше / RRF лучше</div>
                <div className="font-semibold text-text-main mt-0.5">{rerankWins} / {rrfWins}</div>
              </div>
              <div className="p-2 rounded-lg bg-surface-base/10 border border-border-subtle/50">
                <div className="text-text-main/50 text-[10px]">Одинаково / совпали</div>
                <div className="font-semibold text-text-main mt-0.5">{sames}</div>
              </div>
            </div>
          </div>

          {/* Blind comparisons list */}
          <div className="space-y-4">
            {benchResults.map((res, i) => (
              <div
                key={i}
                className={`p-4 rounded-xl border transition-colors ${
                  res.userChoice !== undefined
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
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* Option 1 */}
                      <div className={`p-3 rounded-xl border text-xs space-y-1.5 ${
                        res.userChoice === 'opt1' ? 'border-brand-soft bg-brand-soft/10' : 'border-border-subtle bg-surface-card'
                      }`}>
                        <div className="font-bold text-text-main text-[11px] mb-1">Вариант 1</div>
                        {res.option1Notes.map((n, idx) => (
                          <div key={idx} className="border-b border-border-subtle/50 pb-1 last:border-0 last:pb-0">
                            <div className="font-medium text-text-main/90">{idx + 1}. {n.title || 'Без названия'}</div>
                            <div className="text-[10px] text-text-main/60 line-clamp-1">{n.content.slice(0, 100)}</div>
                          </div>
                        ))}
                      </div>

                      {/* Option 2 */}
                      <div className={`p-3 rounded-xl border text-xs space-y-1.5 ${
                        res.userChoice === 'opt2' ? 'border-brand-soft bg-brand-soft/10' : 'border-border-subtle bg-surface-card'
                      }`}>
                        <div className="font-bold text-text-main text-[11px] mb-1">Вариант 2</div>
                        {res.option2Notes.map((n, idx) => (
                          <div key={idx} className="border-b border-border-subtle/50 pb-1 last:border-0 last:pb-0">
                            <div className="font-medium text-text-main/90">{idx + 1}. {n.title || 'Без названия'}</div>
                            <div className="text-[10px] text-text-main/60 line-clamp-1">{n.content.slice(0, 100)}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Choice Buttons */}
                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        onClick={() => handleChoice(i, 'opt1')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          res.userChoice === 'opt1'
                            ? 'bg-brand-soft text-white border-brand-soft'
                            : 'border-border-subtle text-text-main hover:bg-surface-base/10'
                        }`}
                      >
                        Вариант 1 лучше
                      </Button>
                      <Button
                        onClick={() => handleChoice(i, 'opt2')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          res.userChoice === 'opt2'
                            ? 'bg-brand-soft text-white border-brand-soft'
                            : 'border-border-subtle text-text-main hover:bg-surface-base/10'
                        }`}
                      >
                        Вариант 2 лучше
                      </Button>
                      <Button
                        onClick={() => handleChoice(i, 'same')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          res.userChoice === 'same'
                            ? 'bg-text-main text-surface-base border-text-main'
                            : 'border-border-subtle text-text-main/70 hover:bg-surface-base/10'
                        }`}
                      >
                        Одинаково
                      </Button>
                    </div>
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
