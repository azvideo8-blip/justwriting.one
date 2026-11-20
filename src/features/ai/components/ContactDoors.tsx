import { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { getLocalDb } from '../../../core/storage/localDb';
import { getCurrentUser } from '../../../core/auth';
import { analyzeDoors, aggregateDoors, type AggregatedDoors } from '../utils/contactDoors';
import { Button } from '../../../shared/components/Button';
import { reportError } from '../../../shared/errors/reportError';
import { useLanguage } from '../../../shared/i18n';
import { LoadNotice } from '../../../shared/components/LoadStateView';

const DOORS_CACHE_KEY = 'contact_doors_cache';

interface ContactDoorsProps {
  readOnly?: boolean;
}

export function ContactDoors({ readOnly = false }: ContactDoorsProps = {}) {
  const { t } = useLanguage();
  const [data, setData] = useState<AggregatedDoors | null>(null);
  const uid = getCurrentUser()?.uid ?? 'guest';
  const cacheKey = `${DOORS_CACHE_KEY}_${uid}`;

  const [cache, setCache] = useState<AggregatedDoors | null>(() => {
    try {
      const saved = localStorage.getItem(cacheKey);
      if (saved) return JSON.parse(saved) as AggregatedDoors;
    } catch { /* ignore */ }
    return null;
  });
  // Сбой разбора ≠ «пока пусто»; в профиле (readOnly) кнопки нет — повтор в плашке.
  // Без кэша профиль разбирает сразу: первый кадр — «считаю», а не «пусто».
  const [run, setRun] = useState<'idle' | 'running' | 'error'>(() => (readOnly && !cache ? 'running' : 'idle'));
  const loading = run === 'running';

  const handleAnalyze = async () => {
    setRun('running');
    try {
      const db = await getLocalDb();
      const docs = await db.getAllFromIndex('documents', 'by-guest', uid);
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
        localStorage.setItem(cacheKey, JSON.stringify(result));
      } catch { /* ignore quota */ }
      setRun('idle');
    } catch (e) {
      reportError(e, { action: 'contact_doors_analysis' });
      setRun('error');
    }
  };

  useEffect(() => {
    if (readOnly && !cache) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- async data analysis on mount when readOnly without cache
      void handleAnalyze();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  const display = data ?? cache;

  return (
    <div className="rounded-2xl bg-surface-base/5 border border-border-subtle overflow-hidden">
      <div className="px-5 py-3 border-b border-border-subtle flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-text-main/60 uppercase tracking-wider">{t('ai_doors_title')}</span>
        {!readOnly && (
          <Button
            onClick={() => void handleAnalyze()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-border-subtle text-text-main/60 text-[10px] font-bold disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            {loading ? t('ai_doors_analyzing') : (display ? t('ai_doors_refresh') : t('ai_doors_analyze'))}
          </Button>
        )}
      </div>

      <div className="p-5">
        {run === 'error' && (
          <LoadNotice variant="row" className="mb-3" text={t('load_failed_retry')} onRetry={() => void handleAnalyze()} />
        )}
        {!display && run === 'idle' && (
          <p className="text-xs text-text-main/60">{t('ai_doors_empty')}</p>
        )}

        {display?.lowData && (
          <p className="text-xs text-text-main/60">{t('ai_doors_low_data')}</p>
        )}

        {display && !display.lowData && (
          <>
            <div className="space-y-3 mb-4">
              <DoorBar label={t('ai_doors_thinking')} value={display.thinking} color="bg-accent-info/60" />
              <DoorBar label={t('ai_doors_feeling')} value={display.feeling} color="bg-accent-warning/60" />
              <DoorBar label={t('ai_doors_behavior')} value={display.behavior} color="bg-accent-success/60" />
            </div>

            {display.dominantDoor && display.thinnestDoor && (
              <p className="text-xs text-text-main/60 leading-relaxed mb-3">
                {t('ai_doors_summary', {
                  dominant: t(`ai_doors_${display.dominantDoor}` as 'ai_doors_thinking').toLowerCase(),
                  thinnest: t(`ai_doors_${display.thinnestDoor}` as 'ai_doors_thinking').toLowerCase(),
                })}
              </p>
            )}

            {display.byPeriod.length > 1 && (
              <div className="mt-4">
                <div className="text-[10px] font-mono uppercase tracking-wider text-text-main/60 mb-2">{t('ai_doors_dynamics')}</div>
                <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                  {display.byPeriod.map(p => (
                    <div key={p.period} className="shrink-0 w-20 text-center">
                      <div className="flex flex-col h-20 justify-end rounded-lg bg-surface-card/50 border border-border-subtle overflow-hidden">
                        <div className="bg-accent-info/60" style={{ height: `${p.thinking * 100}%` }} />
                        <div className="bg-accent-warning/60" style={{ height: `${p.feeling * 100}%` }} />
                        <div className="bg-accent-success/60" style={{ height: `${p.behavior * 100}%` }} />
                      </div>
                      <div className="text-[9px] font-mono text-text-main/60 mt-1">{p.period.slice(5)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-[10px] text-text-main/60 mt-4 italic">
              {t('ai_doors_disclaimer')}
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
