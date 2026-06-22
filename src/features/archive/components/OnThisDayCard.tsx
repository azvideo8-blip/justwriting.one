import { useMemo } from 'react';
import { CalendarClock, ArrowRight } from 'lucide-react';
import { getSessionDate } from '../../../core/utils/utils';
import { useLanguage } from '../../../shared/i18n';
import { ArchiveSession } from '../types';

const DAY_MS = 86_400_000;

function findMatch(sessions: ArchiveSession[], t: (k: string) => string): { session: ArchiveSession; label: string } | null {
  const now = new Date();
  const periods: { label: string; shift: (d: Date) => void }[] = [
    { label: t('archive_on_this_day_year'), shift: d => d.setFullYear(now.getFullYear() - 1) },
    { label: t('archive_on_this_day_half_year'), shift: d => d.setMonth(now.getMonth() - 6) },
    { label: t('archive_on_this_day_month'), shift: d => d.setMonth(now.getMonth() - 1) },
  ];
  for (const p of periods) {
    const target = new Date(now);
    p.shift(target);
    const hit = sessions.find(s => {
      const d = getSessionDate(s);
      if (!d || isNaN(d.getTime())) return false;
      return Math.abs(d.getTime() - target.getTime()) <= 2 * DAY_MS;
    });
    if (hit) return { session: hit, label: p.label };
  }
  return null;
}

export function OnThisDayCard({ sessions, onOpen }: {
  sessions: ArchiveSession[];
  onOpen: (s: ArchiveSession) => void;
}) {
  const { t } = useLanguage();
  const match = useMemo(() => findMatch(sessions, t), [sessions, t]);
  if (!match) return null;
  const { session, label } = match;
  const preview = (session.content || '').replace(/\s+/g, ' ').trim().slice(0, 140);

  return (
    <button
      type="button"
      onClick={() => onOpen(session)}
      className="w-full text-left mt-4 rounded-2xl border border-brand-soft/25 bg-brand-soft/[0.06] hover:bg-brand-soft/10 transition-colors px-4 py-3 flex items-start gap-3 group"
    >
      <CalendarClock size={16} className="text-brand-soft shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-soft">{t('archive_on_this_day_title')} · {label}</span>
        </div>
        <div className="text-sm font-medium text-text-main truncate mt-0.5">{session.title || t('archive_untitled')}</div>
        {preview && <div className="text-xs text-text-main/60 mt-0.5 line-clamp-2">{preview}</div>}
      </div>
      <ArrowRight size={14} className="text-text-main/40 group-hover:text-text-main/70 shrink-0 mt-1 transition-colors" />
    </button>
  );
}
