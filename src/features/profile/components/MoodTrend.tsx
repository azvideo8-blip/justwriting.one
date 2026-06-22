import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../../../shared/i18n';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { cn } from '../../../core/utils/utils';

// Mood is stored as one of 6 emotion emojis on a note. These are categorical
// (not a linear scale), so we show the actual emotional arc over time + a
// distribution, tinting by rough valence rather than faking a numeric axis.
const MOOD_META: Record<string, { key: string; tone: 'pos' | 'neu' | 'neg' }> = {
  '😊': { key: 'mood_happy', tone: 'pos' },
  '🤔': { key: 'mood_interest', tone: 'neu' },
  '😨': { key: 'mood_fear', tone: 'neg' },
  '😠': { key: 'mood_anger', tone: 'neg' },
  '🤢': { key: 'mood_disgust', tone: 'neg' },
  '😢': { key: 'mood_sad', tone: 'neg' },
};
const ORDER = ['😊', '🤔', '😨', '😠', '🤢', '😢'];
const TONE_CLASS: Record<string, string> = {
  pos: 'bg-emerald-400/15 border-emerald-400/30',
  neu: 'bg-amber-400/15 border-amber-400/30',
  neg: 'bg-rose-400/15 border-rose-400/30',
};

export function MoodTrend({ userId }: { userId: string }) {
  const { t, language } = useLanguage();
  const [entries, setEntries] = useState<{ mood: string; date: number }[]>([]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void LocalDocumentService.getGuestDocuments(userId).then(docs => {
      if (!active) return;
      const cutoff = Date.now() - 60 * 86_400_000; // last ~2 months
      const withMood = docs
        .filter(d => typeof d.mood === 'string' && MOOD_META[d.mood] !== undefined && (d.lastSessionAt ?? 0) >= cutoff)
        .map(d => ({ mood: d.mood as string, date: d.lastSessionAt ?? 0 }))
        .sort((a, b) => a.date - b.date);
      setEntries(withMood);
    });
    return () => { active = false; };
  }, [userId]);

  const { counts, total, top } = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of entries) counts[e.mood] = (counts[e.mood] ?? 0) + 1;
    const total = entries.length;
    let top: string | null = null;
    for (const m of ORDER) if (counts[m] && (!top || counts[m]! > counts[top]!)) top = m;
    return { counts, total, top };
  }, [entries]);

  if (total === 0) return null;

  const fmtDate = (ts: number) => new Date(ts).toLocaleDateString(language, { day: 'numeric', month: 'short' });

  // Continuous per-day axis (last 30 days): a day with a mood shows its emoji,
  // a skipped day shows a dot — so the timeline reflects real spacing.
  const DAYS = 30;
  const dayKey = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
  const moodByDay = new Map<string, string>();
  for (const e of entries) moodByDay.set(dayKey(e.date), e.mood); // later (newer) wins
  const timeline: { ts: number; mood: string | null }[] = [];
  const start = new Date(); start.setHours(0, 0, 0, 0);
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(start); d.setDate(start.getDate() - i);
    timeline.push({ ts: d.getTime(), mood: moodByDay.get(dayKey(d.getTime())) ?? null });
  }

  return (
    <div className="px-4 py-6 md:px-9 md:py-8 border-b border-border-subtle">
      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-3 mb-4">
        <h2 className="text-[18px] font-medium text-text-main">{t('profile_mood_title')}</h2>
        {top && (
          <div className="font-mono text-label-sm text-text-main/60">
            {t('profile_mood_most')} <span className="text-base align-middle">{top}</span> {t(MOOD_META[top]!.key)}
          </div>
        )}
      </div>

      {/* Timeline: one cell per day; skipped days are dots, so spacing is real */}
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-1">
        {timeline.map((d, i) => (
          <div key={i} className="shrink-0 flex items-center justify-center" title={fmtDate(d.ts)}>
            {d.mood ? (
              <div className={cn('w-7 h-7 rounded-lg border flex items-center justify-center text-base', TONE_CLASS[MOOD_META[d.mood]!.tone])}>
                {d.mood}
              </div>
            ) : (
              <div className="w-7 h-7 flex items-center justify-center">
                <span className="w-1 h-1 rounded-full bg-text-main/20" />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-1.5 font-mono text-label text-text-main/50">
        <span>{fmtDate(timeline[0]!.ts)}</span>
        <span>{fmtDate(timeline[timeline.length - 1]!.ts)}</span>
      </div>

      {/* Distribution over the period */}
      <div className="flex flex-wrap gap-3 mt-5">
        {ORDER.filter(m => counts[m]).map(m => (
          <div key={m} className="flex items-center gap-1.5 text-sm text-text-main/70">
            <span className="text-base">{m}</span>
            <span className="font-mono text-text-main/60">{counts[m]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
