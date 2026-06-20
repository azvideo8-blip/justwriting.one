import { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { getLocalDb } from '../../../core/storage/localDb';
import { analyzeDoors, aggregateDoors, doorLabel, type AggregatedDoors } from '../utils/contactDoors';
import { Button } from '../../../shared/components/Button';

const DOORS_CACHE_KEY = 'contact_doors_cache';

export function ContactDoors() {
  const [data, setData] = useState<AggregatedDoors | null>(null);
  const [loading, setLoading] = useState(false);
  const [cache, setCache] = useState<AggregatedDoors | null>(null);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DOORS_CACHE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as AggregatedDoors;
        setCache(parsed);
      }
    } catch { /* ignore */ }
  }, []);

  const handleAnalyze = async () => {
    setLoading(true);
    try {
      const db = await getLocalDb();
      const docs = await db.getAll('documents');
      const perNote: { doors: ReturnType<typeof analyzeDoors>; ts: number }[] = [];
      for (const doc of docs) {
        const versions = await db.getAllFromIndex('versions', 'by-document', doc.id);
        if (versions.length === 0) continue;
        versions.sort((a, b) => b.version - a.version);
        const text = versions[0]?.content ?? '';
        const doors = analyzeDoors(text);
        perNote.push({ doors, ts: doc.lastSessionAt ?? doc.firstSessionAt ?? Date.now() });
      }
      const result = aggregateDoors(perNote);
      setData(result);
      setCache(result);
      // Persist to localStorage
      try {
        localStorage.setItem(DOORS_CACHE_KEY, JSON.stringify(result));
      } catch { /* ignore quota */ }
    } catch (e) {
      console.warn('[ContactDoors] analysis failed:', e);
    } finally {
      setLoading(false);
    }
  };

  const display = data ?? cache;

  return (
    <div className="rounded-2xl bg-surface-base/5 border border-border-subtle overflow-hidden">
      <div className="px-5 py-3 border-b border-border-subtle flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-text-main/60 uppercase tracking-wider">Три двери контакта</span>
        <Button
          onClick={() => void handleAnalyze()}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-border-subtle text-text-main/60 text-[10px] font-bold disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Анализ…' : (display ? 'Обновить' : 'Анализировать')}
        </Button>
      </div>

      <div className="p-5">
        {!display && !loading && (
          <p className="text-xs text-text-main/60">Нажми «Анализировать», чтобы увидеть, куда направлено внимание в записях.</p>
        )}

        {display?.lowData && (
          <p className="text-xs text-text-main/60">Недостаточно данных для анализа. Напиши больше заметок.</p>
        )}

        {display && !display.lowData && (
          <>
            <div className="space-y-3 mb-4">
              <DoorBar label="Мысли" value={display.thinking} color="bg-blue-500/60" />
              <DoorBar label="Чувства" value={display.feeling} color="bg-amber-500/60" />
              <DoorBar label="Поведение" value={display.behavior} color="bg-emerald-500/60" />
            </div>

            {display.dominantDoor && display.thinnestDoor && (
              <p className="text-xs text-text-main/60 leading-relaxed mb-3">
                Сейчас твоё внимание чаще идёт через <strong className="text-text-main">{doorLabel(display.dominantDoor)}</strong>;
                тоньше всего — <strong className="text-text-main">{doorLabel(display.thinnestDoor)}</strong>.
              </p>
            )}

            {display.byPeriod.length > 1 && (
              <div className="mt-4">
                <div className="text-[10px] font-mono uppercase tracking-wider text-text-main/60 mb-2">Динамика по месяцам</div>
                <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                  {display.byPeriod.map(p => (
                    <div key={p.period} className="shrink-0 w-20 text-center">
                      <div className="flex flex-col h-20 justify-end rounded-lg bg-surface-card/50 border border-border-subtle overflow-hidden">
                        <div className="bg-blue-500/60" style={{ height: `${p.thinking * 100}%` }} />
                        <div className="bg-amber-500/60" style={{ height: `${p.feeling * 100}%` }} />
                        <div className="bg-emerald-500/60" style={{ height: `${p.behavior * 100}%` }} />
                      </div>
                      <div className="text-[9px] font-mono text-text-main/60 mt-1">{p.period.slice(5)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-[10px] text-text-main/60 mt-4 italic">
              Это про то, куда направлено внимание в записях, а не диагноз.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function DoorBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-text-main/60 w-20 shrink-0">{label}</span>
      <div className="flex-1 h-5 rounded-lg bg-surface-card/50 border border-border-subtle overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${value * 100}%` }} />
      </div>
      <span className="text-xs font-mono text-text-main/60 w-10 text-right shrink-0">{Math.round(value * 100)}%</span>
    </div>
  );
}
