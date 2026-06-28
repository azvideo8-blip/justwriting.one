import { useState } from 'react';
import { Loader2, Gauge } from 'lucide-react';
import { cn } from '../../../core/utils/utils';
import { Button } from '../../../shared/components/Button';
import { useToast } from '../../../shared/components/Toast';
import { AIEmbeddingService } from '../services/AIEmbeddingService';
import { getLocalDb } from '../../../core/storage/localDb';
import { cosineSimilarity } from '../utils/vectorSearch';
import { getDomainSeedVectors, type DomainSeedVec } from '../utils/domainSeeds';
import { reportError } from '../../../shared/errors/reportError';

interface DomainScore {
  id: string;
  label: string;
  score: number;
  threshold: number;
}

interface NoteRow {
  docId: string;
  title: string;
  chunkCount: number;
  noDomainChunks: number;
  topDomains: DomainScore[];
  assignedDomainId: string | null;
}

interface Summary {
  perDomain: { id: string; label: string; noteCount: number }[];
  noDomainNotes: number;
  totalNoDomainChunks: number;
  totalNotes: number;
  totalChunks: number;
}

function fmtScore(s: number): string {
  return s.toFixed(2);
}

export function FacetDiagnostics() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [ran, setRan] = useState(false);
  const [noEmbeddings, setNoEmbeddings] = useState(false);
  const [rows, setRows] = useState<NoteRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);

  const handleRun = async () => {
    setLoading(true);
    try {
      const [embeddings, db] = await Promise.all([
        AIEmbeddingService.getAll(),
        getLocalDb(),
      ]);
      const docs = await db.getAll('documents');
      const docMap = new Map(docs.map(d => [d.id, d]));

      if (embeddings.length === 0) {
        setRows([]);
        setSummary(null);
        setNoEmbeddings(true);
        setRan(true);
        return;
      }

      const seeds = await getDomainSeedVectors();
      if (seeds.length === 0) {
        showToast('Ошибка эмбеддинга доменов', 'error');
        return;
      }

      const newRows: NoteRow[] = [];
      const perDomainCount = new Map<string, number>();
      for (const s of seeds) perDomainCount.set(s.id, 0);
      let noDomainNotes = 0;
      let totalNoDomainChunks = 0;
      let totalChunks = 0;

      for (const emb of embeddings) {
        const chunks = emb.vectors;
        if (chunks.length === 0) continue;
        totalChunks += chunks.length;
        const doc = docMap.get(emb.documentId);
        const title = doc?.title ?? '(без названия)';

        const domainScores: DomainScore[] = seeds.map((s: DomainSeedVec) => {
          let best = -Infinity;
          for (const cv of chunks) {
            const sc = cosineSimilarity(cv, s.vec);
            if (sc > best) best = sc;
          }
          return { id: s.id, label: s.label, score: best, threshold: s.threshold };
        });

        let noDomainChunks = 0;
        for (const cv of chunks) {
          const matched = seeds.some(s => cosineSimilarity(cv, s.vec) >= s.threshold);
          if (!matched) noDomainChunks++;
        }
        totalNoDomainChunks += noDomainChunks;

        const sortedByScore = [...domainScores].sort((a, b) => b.score - a.score);
        const top = sortedByScore.slice(0, 3);
        const assigned = sortedByScore.find(d => d.score >= d.threshold);
        const assignedDomainId = assigned ? assigned.id : null;
        if (assignedDomainId) {
          perDomainCount.set(assignedDomainId, (perDomainCount.get(assignedDomainId) ?? 0) + 1);
        } else {
          noDomainNotes++;
        }

        newRows.push({
          docId: emb.documentId,
          title,
          chunkCount: chunks.length,
          noDomainChunks,
          topDomains: top,
          assignedDomainId,
        });
      }

      const perDomain = seeds.map(s => ({
        id: s.id,
        label: s.label,
        noteCount: perDomainCount.get(s.id) ?? 0,
      }));

      newRows.sort((a, b) => {
        if (b.chunkCount !== a.chunkCount) return b.chunkCount - a.chunkCount;
        return a.title.localeCompare(b.title);
      });

      setRows(newRows);
      setSummary({
        perDomain,
        noDomainNotes,
        totalNoDomainChunks,
        totalNotes: newRows.length,
        totalChunks,
      });
      setNoEmbeddings(false);
      setRan(true);
    } catch (e) {
      reportError(e, { action: 'facet_diagnostics_run' });
      showToast('Ошибка диагностики порогов', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl bg-surface-base/5 border border-border-subtle overflow-hidden">
      <div className="px-5 py-3 border-b border-border-subtle flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-text-main/60 uppercase tracking-wider flex items-center gap-2">
          <Gauge size={13} className="text-brand-soft" />
          Диагностика доменов (DEV)
        </span>
        <Button
          onClick={() => void handleRun()}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-brand-soft/20 bg-brand-soft/10 text-brand-soft text-[10px] font-bold disabled:opacity-50"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <Gauge size={12} />}
          {loading ? 'Расчёт…' : 'Диагностика порогов'}
        </Button>
      </div>

      <div className="p-4">
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 size={16} className="animate-spin text-text-main/60" />
          </div>
        ) : noEmbeddings ? (
          <p className="text-xs text-text-main/60 italic py-6 text-center">
            Сначала проиндексируйте заметки (вкладка «База данных»)
          </p>
        ) : !ran ? (
          <p className="text-xs text-text-main/60 italic py-6 text-center">
            Нажми «Диагностика порогов» — для каждой заметки посчитается лучший косинус к каждому домену.
          </p>
        ) : summary && rows.length > 0 ? (
          <div className="space-y-4">
            {/* Corpus summary */}
            <div className="rounded-xl border border-border-subtle bg-surface-card/20 p-3 space-y-2">
              <div className="text-[10px] font-bold text-text-main/60 uppercase tracking-wider">
                Корпус: {summary.totalNotes} заметок · {summary.totalChunks} чанков
              </div>
              <div className="flex flex-wrap gap-1.5">
                {summary.perDomain.map(d => (
                  <span
                    key={d.id}
                    className={cn(
                      'text-[10px] font-bold px-2 py-0.5 rounded-full',
                      d.noteCount > 0
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-surface-base/10 text-text-main/60',
                    )}
                  >
                    {d.label}: {d.noteCount}
                  </span>
                ))}
              </div>
              <div className="text-[10px] text-text-main/60 font-mono">
                без домена: {summary.noDomainNotes} заметок · чанков без домена: {summary.totalNoDomainChunks}
              </div>
            </div>

            {/* Per-note rows */}
            <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
              {rows.map(row => (
                <div
                  key={row.docId}
                  className="rounded-lg border border-border-subtle bg-surface-card/10 p-2.5 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-text-main truncate">
                      {row.title}
                    </span>
                    <span className="text-[9px] text-text-main/60 font-mono shrink-0">
                      {row.chunkCount} чанков · {row.noDomainChunks} без домена
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {row.topDomains.map(d => {
                      const passes = d.score >= d.threshold;
                      return (
                        <span
                          key={d.id}
                          className={cn(
                            'text-[10px] font-mono px-1.5 py-0.5 rounded',
                            passes
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'bg-surface-base/10 text-text-main/60',
                          )}
                          title={`порог: ${d.threshold}`}
                        >
                          {d.label} {fmtScore(d.score)}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-text-main/60 italic py-6 text-center">
            Нет заметок с чанками для анализа.
          </p>
        )}
        <p className="text-[10px] text-text-main/60 mt-3">
          Только чтение: косинус лучшего чана заметки к каждому домену. Зелёным — проходит порог, серым — нет. Не пишет в aiProfileFacets.
        </p>
      </div>
    </div>
  );
}
