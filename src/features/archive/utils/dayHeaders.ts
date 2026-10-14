import { differenceInCalendarDays, format } from 'date-fns';
import type { Locale } from 'date-fns';

/** Ключ группы — 'yyyy-MM-dd' из `useArchiveGrouping`; `new Date(key)` читает его
 *  как UTC-полночь и в западных часах сдвигает день назад, поэтому разбираем
 *  locally сами. */
function parseDayKey(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

const capitalize = (value: string) => value.replace(/^./, c => c.toUpperCase());

/** MC-7: заголовок дня на телефоне — только слова. Числа (заметки, слова)
 *  ушли в лист «Календарь и статистика»: в прокрутке они превращали каждую
 *  группу в строку отчёта. */
export function formatDayHeader(dateKey: string, t: (k: string) => string, locale: Locale, now = new Date()): string {
  const date = parseDayKey(dateKey);
  const days = differenceInCalendarDays(now, date);
  if (days === 0) return t('archive_day_today');
  if (days === 1) return t('archive_day_yesterday');
  if (days < 30) return format(date, 'd MMMM', { locale });
  return capitalize(format(date, 'LLLL', { locale }));
}
