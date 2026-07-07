import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CalendarClock, ArrowRight, X } from 'lucide-react';
import { format } from 'date-fns';
import { getSessionDate } from '../../../core/utils/utils';
import { getDateLocale } from '../../../core/utils/dateUtils';
import { useLanguage } from '../../../shared/i18n';
import { ArchiveSession } from '../types';

const DISMISS_KEY = 'onthisday_dismissed';

function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

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
      return isSameCalendarDay(d, target);
    });
    if (hit) return { session: hit, label: p.label };
  }
  return null;
}

function trimExcerpt(text: string, max = 120): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice) + '\u2026';
}

export function OnThisDayCard({ sessions, onOpen }: {
  sessions: ArchiveSession[];
  onOpen: (s: ArchiveSession) => void;
}) {
  const { t, language } = useLanguage();
  const reducedMotion = useReducedMotion();
  const [dismissedId, setDismissedId] = useState<string | null>(() => {
    try { return localStorage.getItem(DISMISS_KEY); } catch { return null; }
  });
  const [dismissing, setDismissing] = useState(false);
  const match = useMemo(() => findMatch(sessions, t), [sessions, t]);
  if (!match || match.session.id === dismissedId) return null;
  const { session, label } = match;
  const excerpt = trimExcerpt(session.content || '');
  const date = getSessionDate(session);
  const dateChip = date ? format(date, 'd MMM yy', { locale: getDateLocale(language) }) : null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, session.id); } catch { /* ignore */ }
    if (reducedMotion) {
      setDismissedId(session.id);
    } else {
      setDismissing(true);
    }
  };

  return (
    <AnimatePresence onExitComplete={() => setDismissedId(session.id)}>
      {!dismissing && (
        <motion.div
          key={session.id}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="w-full mt-4 rounded-2xl border border-brand-soft/25 bg-gradient-to-br from-brand-soft/[0.08] to-brand-soft/[0.02] hover:border-brand-soft/40 hover:-translate-y-px transition-[border-color,transform] flex items-stretch group overflow-hidden"
        >
          <div className="w-1 shrink-0 bg-brand-soft/50" />
          <button
            type="button"
            onClick={() => onOpen(session)}
            className="flex-1 min-w-0 text-left px-4 py-3.5 flex items-start gap-3"
          >
            <div className="shrink-0 mt-0.5">
              <div className="w-8 h-8 rounded-full bg-brand-soft/15 flex items-center justify-center">
                <CalendarClock size={16} className="text-brand-soft" />
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-soft">{t('archive_on_this_day_title')}</span>
                <span className="text-[11px] text-text-main/40">·</span>
                <span className="text-[11px] text-text-main/60">{label}</span>
                {dateChip && (
                  <span className="text-[11px] font-mono tabular-nums px-1.5 py-0.5 rounded-md bg-brand-soft/10 text-brand-soft/80">
                    {dateChip}
                  </span>
                )}
              </div>
              <div className="text-sm font-medium text-text-main truncate mt-1">{session.title || t('archive_untitled')}</div>
              {excerpt && <div className="text-xs text-text-main/55 mt-0.5 line-clamp-2 leading-relaxed">{excerpt}</div>}
            </div>
            <ArrowRight size={14} className="text-text-main/40 group-hover:text-text-main/70 shrink-0 mt-1 transition-colors" />
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t('archive_on_this_day_dismiss')}
            title={t('archive_on_this_day_dismiss')}
            className="shrink-0 px-2.5 text-text-main/40 hover:text-text-main transition-colors"
          >
            <X size={15} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
