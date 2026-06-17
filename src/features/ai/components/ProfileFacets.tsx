import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Sparkles, Layers, Copy, FileText, PenLine } from 'lucide-react';
import { cn } from '../../../core/utils/utils';
import { Button } from '../../../shared/components/Button';
import { useToast } from '../../../shared/components/Toast';
import { AIProfileFacetService } from '../services/AIProfileFacetService';
import type { AIProfileFacet, LocalDocument } from '../../../core/storage/localDb';
import { getLocalDb } from '../../../core/storage/localDb';

const RECENT_MS = 14 * 24 * 60 * 60 * 1000;

function trend(f: AIProfileFacet): { label: string; cls: string } {
  const now = Date.now();
  if (f.firstAt && now - f.firstAt < RECENT_MS) return { label: 'новая', cls: 'bg-brand-soft/15 text-brand-soft' };
  if (f.lastAt && now - f.lastAt < RECENT_MS) return { label: 'активна', cls: 'bg-emerald-500/15 text-emerald-400' };
  return { label: 'затихла', cls: 'bg-surface-base/10 text-text-main/40' };
}

function fmt(ts: number): string {
  return ts ? new Date(ts).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';
}

export function ProfileFacets() {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [facets, setFacets] = useState<AIProfileFacet[]>([]);
  const [docMap, setDocMap] = useState<Map<string, LocalDocument>>(new Map());
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handleExport = async () => {
    const db = await getLocalDb();
    const docs = await db.getAll('documents');
    const docMap = new Map(docs.map(d => [d.id, d]));
    const md = facets.map(f => {
      const notes = f.noteIds
        .map(id => docMap.get(id))
        .filter(Boolean)
        .map(d => `  - ${d!.title} (${fmt(d!.lastSessionAt)})`)
        .join('\n');
      return `## ${f.label} — ${f.noteCount} заметок (${fmt(f.firstAt)} – ${fmt(f.lastAt)})\n\n${f.summary || '—'}\n\nЗаметки:\n${notes || '  (пусто)'}`;
    }).join('\n\n---\n\n');
    try {
      await navigator.clipboard.writeText(md);
      showToast('Темы скопированы в буфер', 'success');
    } catch {
      showToast('Не удалось скопировать', 'error');
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getLocalDb();
      const [f, docs] = await Promise.all([AIProfileFacetService.getAll(), db.getAll('documents')]);
      setFacets(f);
      setDocMap(new Map(docs.map(d => [d.id, d])));
    } catch (e) {
      console.error('[ProfileFacets] load failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleBuild = async () => {
    setBuilding(true);
    setProgress(null);
    try {
      const res = await AIProfileFacetService.build(p => setProgress(p));
      if (res.ok) showToast(`Темы профиля построены: ${res.count}`, 'success');
      else if (res.error === 'NO_EMBEDDINGS') showToast('Сначала проиндексируйте заметки (вкладка «База данных»)', 'error');
      else if (res.error === 'NO_CHUNK_TEXTS') showToast('Нужен реиндекс: «База данных» → «Переиндексировать всё» (обновлён формат эмбеддингов)', 'error');
      else showToast('Не удалось выделить темы — мало заметок', 'error');
    } catch (e) {
      console.error('[ProfileFacets] build failed:', e);
      showToast('Ошибка построения тем', 'error');
    } finally {
      setBuilding(false);
      setProgress(null);
      void load();
    }
  };

  const handleResummarize = async () => {
    setBuilding(true);
    setProgress(null);
    try {
      const { count } = await AIProfileFacetService.resummarizeDirty(p => setProgress(p));
      showToast(count > 0 ? `Обновлено ${count} тем` : 'Нет тем для обновления', count > 0 ? 'success' : 'error');
    } catch (e) {
      console.error('[ProfileFacets] resummarize failed:', e);
      showToast('Ошибка обновления тем', 'error');
    } finally {
      setBuilding(false);
      setProgress(null);
      void load();
    }
  };

  return (
    <div className="rounded-2xl bg-surface-base/5 border border-border-subtle overflow-hidden">
      <div className="px-5 py-3 border-b border-border-subtle flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-text-main/50 uppercase tracking-wider flex items-center gap-2">
          <Layers size={13} className="text-brand-soft" />
          Темы профиля (кластеры заметок)
        </span>
          <div className="flex items-center gap-1.5">
          {facets.some(f => f.dirty) && (
            <Button
              onClick={() => { void handleResummarize(); }}
              disabled={building}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-400 text-[10px] font-bold disabled:opacity-50"
            >
              <Sparkles size={12} />
              Обновить описания
            </Button>
          )}
          {facets.length > 0 && (
            <Button
              onClick={() => void handleExport()}
              disabled={building}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-border-subtle text-text-main/60 text-[10px] font-bold disabled:opacity-50"
            >
              <Copy size={12} />
              Выгрузить
            </Button>
          )}
          <Button
            onClick={() => void handleBuild()}
            disabled={building}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-brand-soft/20 bg-brand-soft/10 text-brand-soft text-[10px] font-bold disabled:opacity-50"
          >
            {building ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {building && progress ? `Анализ ${progress.done}/${progress.total}…` : (facets.length ? 'Перестроить' : 'Построить темы')}
          </Button>
        </div>
      </div>

      <div className="p-4">
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 size={16} className="animate-spin text-text-main/30" /></div>
        ) : facets.length === 0 ? (
          <p className="text-xs text-text-main/30 italic py-6 text-center">
            Темы ещё не построены. Нажми «Построить темы» — заметки сгруппируются по смыслу, и для каждой темы появится описание.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {facets.map(f => {
              const t = trend(f);
              const isExp = expanded.has(f.id);
              return (
                <div
                  key={f.id}
                  onClick={() => toggle(f.id)}
                  className={cn(
                    'p-3.5 rounded-xl border border-border-subtle bg-surface-card/20 space-y-1.5 cursor-pointer transition-colors hover:bg-surface-card/40',
                    isExp && 'sm:col-span-2'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn('text-sm font-semibold text-text-main', !isExp && 'truncate')}>{f.label}</span>
                    <div className="flex items-center gap-1.5">
                      {f.dirty && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400">новое</span>}
                      {(f.insightDensity ?? 0) >= 0.5 && <PenLine size={11} className="text-violet-400" />}
                      <span className={cn('text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0', t.cls)}>{t.label}</span>
                    </div>
                  </div>
                  <p className={cn('text-[11px] text-text-main/60 leading-relaxed whitespace-pre-wrap', !isExp && 'line-clamp-4')}>{f.summary || '—'}</p>
                  {isExp && (
                    <div className="mt-2 space-y-1">
                      <span className="text-[9px] font-bold text-text-main/40 uppercase tracking-wider">Заметки темы</span>
                      <div className="max-h-40 overflow-y-auto space-y-0.5">
                        {f.noteIds.map(id => {
                          const doc = docMap.get(id);
                          return (
                            <button
                              key={id}
                              onClick={e => { e.stopPropagation(); void navigate(`/ai?doc=${id}`); }}
                              className="flex items-center gap-1.5 w-full text-left px-2 py-1 rounded-md hover:bg-brand-soft/10 transition-colors group"
                            >
                              <FileText size={10} className="shrink-0 text-text-main/30 group-hover:text-brand-soft" />
                              <span className="text-[10px] text-text-main/50 group-hover:text-text-main/80 truncate flex-1">{doc?.title ?? '(без названия)'}</span>
                              <span className="text-[9px] text-text-main/25 font-mono shrink-0">{doc ? fmt(doc.lastSessionAt) : ''}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-[9px] text-text-main/30 font-mono pt-0.5">
                    <span>{f.noteCount} заметок · {isExp ? 'свернуть' : 'развернуть'}</span>
                    <span>{fmt(f.firstAt)} – {fmt(f.lastAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-[10px] text-text-main/30 mt-3">
          Темы выделяются кластеризацией эмбеддингов заметок (локально), описание каждой — ИИ по её заметкам. Заметка может попадать в несколько тем.
        </p>
      </div>
    </div>
  );
}
