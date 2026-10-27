import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CalendarClock, ArrowRight, ChevronRight, X } from 'lucide-react';
import { format, subMonths, subYears } from 'date-fns';
import { getSessionDate, getSessionDates } from '../utils/utils';
import { getDateLocale } from '../utils/dateUtils';
import { useLanguage } from '../../shared/i18n';
import { useLayoutMode } from '../../shared/hooks/useLayoutMode';
import type { ArchiveSession } from '../../shared/types/common';

/** RA1-7: закрытие — только на сегодня. Хранится дата, а не id заметки. */
export function onThisDayDismissKey(userId?: string | null): string {
  return `onthisday_dismissed_${userId || 'guest'}`;
}

export function readDismissedDay(userId: string | null | undefined): string | null {
  try {
    return localStorage.getItem(onThisDayDismissKey(userId));
  } catch {
    return null;
  }
}

export function writeDismissedDay(userId: string | null | undefined, today: string): void {
  try {
    localStorage.setItem(onThisDayDismissKey(userId), today);
  } catch { /* ignore */ }
}

/** RA1-7: окно ±1 день — «в этот день» не должно промахиваться на стыке суток. */
function dayDistance(a: Date, b: Date): number {
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.abs(Math.round((da - db) / 86_400_000));
}

export function findMatch(
  sessions: ArchiveSession[],
  t: (k: string) => string,
  referenceDate: Date = new Date(),
): { session: ArchiveSession; label: string; matchedDate: Date } | null {
  const now = referenceDate;
  // DEEP-12: subMonths/subYears корректно зажимают 31-е числа (например, 31 марта -> 28/29 февраля)
  const periods: { label: string; target: Date }[] = [
    { label: t('archive_on_this_day_year'), target: subYears(now, 1) },
    { label: t('archive_on_this_day_half_year'), target: subMonths(now, 6) },
    { label: t('archive_on_this_day_month'), target: subMonths(now, 1) },
  ];
  for (const p of periods) {
    const candidates: { session: ArchiveSession; date: Date; distance: number }[] = [];
    for (const s of sessions) {
      // RA1-7: заметка в корзине — не воспоминание.
      if (s.trashedAt) continue;
      for (const d of getSessionDates(s)) {
        const distance = dayDistance(d, p.target);
        if (distance <= 1) candidates.push({ session: s, date: d, distance });
      }
    }
    if (candidates.length === 0) continue;
    // RA1-7: детерминированно — ближайшая дата; равные — по id, чтобы выбор
    // не зависел от порядка строк.
    candidates.sort((a, b) =>
      a.distance - b.distance
      || b.date.getTime() - a.date.getTime()
      || a.session.id.localeCompare(b.session.id)
    );
    const best = candidates[0]!;
    return { session: best.session, label: p.label, matchedDate: best.date };
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

export function OnThisDayCard({ sessions, onOpen, userId, showExcerpt = true, compact = false }: {
  sessions: ArchiveSession[];
  onOpen: (s: ArchiveSession) => void;
  userId?: string | null | undefined;
  /**
   * BR-7: домашняя карточка — только название, как на телефоне: экран может
   * быть открыт при ком-то (тот же довод, что у RA1-3 про «Продолжить»).
   * В архиве выдержка остаётся (RC-6).
   */
  showExcerpt?: boolean;
  /** Главный на компьютере (владелец 26.10): строка, как на телефоне, а не карточка. */
  compact?: boolean;
}) {
  const { t, language } = useLanguage();
  const { layoutMode } = useLayoutMode();
  const asRow = layoutMode === 'mobile' || compact;
  const reducedMotion = useReducedMotion();
  const today = format(new Date(), 'yyyy-MM-dd');
  const [dismissedDay, setDismissedDay] = useState<string | null>(() => readDismissedDay(userId));
  const dismissedToday = dismissedDay === today;
  const [dismissing, setDismissing] = useState(false);
  const match = useMemo(() => findMatch(sessions, t), [sessions, t]);
  if (!match || dismissedToday) return null;
  const { session, label, matchedDate } = match;
  // A note whose text is locked or not fetched yet still happened on this day —
  // the match stays, the excerpt says why it is empty instead of showing ''.
  const excerpt = session._locked
    ? t('archive_note_locked')
    : (session._decryptionError || session._contentError || session._contentNotLoaded)
      ? t('archive_no_content')
      : trimExcerpt(session.content || '');
  const date = matchedDate ?? getSessionDate(session);
  const dateChip = format(date, 'd MMM yy', { locale: getDateLocale(language) });

  const dismiss = () => {
    // RA1-7: «на сегодня», не навсегда — завтра карточка вернётся.
    writeDismissedDay(userId, today);
    // На телефоне уход не анимируется (строка, а не карточка) — прячем сразу;
    // раньше «×» там не действовал вовсе, если не включено reduced motion.
    if (asRow || reducedMotion) {
      setDismissedDay(today);
    } else {
      setDismissing(true);
    }
  };

  // MC-7: на телефоне напоминание — обычная строка: нет карточки в карточке,
  // нет цветного левого края и плашки с датой. Дата и заголовок читаются в
  // одной строке, стрелка справа говорит «откроется».
  if (asRow) {
    return (
      <div className="flex items-center border-b border-[var(--border-light)]">
        <button
          type="button"
          onClick={() => onOpen(session)}
          className="press flex-1 min-w-0 flex items-center gap-2.5 px-1 py-3 min-h-11 text-left"
        >
          <CalendarClock size={16} className="shrink-0 text-[var(--text-subtle)]" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[15px] text-[var(--text-main)]">
            {t('archive_on_this_day_title')} {label}: {session.title || t('archive_untitled')}
          </span>
          <ChevronRight size={16} className="shrink-0 text-[var(--text-subtle)]" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('archive_on_this_day_dismiss')}
          className="w-11 h-11 shrink-0 flex items-center justify-center text-[var(--text-subtle)]"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <AnimatePresence onExitComplete={() => setDismissedDay(today)}>
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
              {showExcerpt && excerpt && <div className="text-xs text-text-main/55 mt-0.5 line-clamp-2 leading-relaxed">{excerpt}</div>}
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
