import { parse, format } from 'date-fns';
import { ru } from 'date-fns/locale/ru';
import { enUS } from 'date-fns/locale/en-US';

type DateFnsLocale = import('date-fns/locale').Locale;

/** R4-5: день заметки по местному времени (YYYY-MM-DD). `toISOString().slice(0, 10)`
 *  даёт день по UTC — запись в 00:30 по Москве попадала во «вчера», тогда как
 *  стрик и архив считают день по-местному. Серверные дневные лимиты — по UTC,
 *  там этот ключ не нужен. */
export function localDayKey(d: Date | number = new Date()): string {
  return format(d, 'yyyy-MM-dd');
}

export function localMonthKey(d: Date | number = new Date()): string {
  return format(d, 'yyyy-MM');
}

export function getDateLocale(lang: string): DateFnsLocale {
  return lang === 'ru' ? ru : enUS;
}

const LOCALIZED_DATE_FORMATS: { fmt: string; loc: DateFnsLocale }[] = [
  { fmt: "d MMMM yyyy 'г.'", loc: ru },
  { fmt: "d MMMM yyyy 'г'", loc: ru },
  { fmt: 'd MMMM yyyy', loc: ru },
  { fmt: 'dd.MM.yyyy', loc: ru },
  { fmt: 'd.M.yyyy', loc: ru },
  { fmt: 'MMMM d, yyyy', loc: enUS },
  { fmt: 'd MMMM yyyy', loc: enUS },
  { fmt: 'MM/dd/yyyy', loc: enUS },
  { fmt: 'dd/MM/yyyy', loc: enUS },
  { fmt: 'yyyy-MM-dd', loc: enUS },
];

export function parseLocalizedDate(v: unknown): Date | null {
  if (!v || typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (!trimmed) return null;

  // 1. Check if native Date parses standard ISO-8601 strings
  // Только дата (YYYY-MM-DD) — это день по местному времени, а new Date() читает её
  // как полночь UTC: к западу от Гринвича выходил предыдущий день (DA-21).
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const local = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    if (!isNaN(local.getTime())) return local;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const iso = new Date(trimmed);
    if (!isNaN(iso.getTime())) return iso;
  }

  // 2. Try explicit localized formats (Russian and English long dates)
  for (const { fmt, loc } of LOCALIZED_DATE_FORMATS) {
    try {
      const d = parse(trimmed, fmt, new Date(), { locale: loc });
      if (!isNaN(d.getTime())) return d;
    } catch {
      /* continue to next format */
    }
  }

  // 3. Fallback to native Date parser
  const native = new Date(trimmed);
  if (!isNaN(native.getTime())) return native;

  return null;
}

export function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'object' && v !== null) {
    const obj = v as Record<string, unknown>;
    if (typeof obj['toDate'] === 'function') {
      const d = (obj['toDate'] as () => Date)();
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof obj['toMillis'] === 'function') {
      const d = new Date((obj['toMillis'] as () => number)());
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof obj['seconds'] === 'number') {
      const d = new Date(obj['seconds'] * 1000);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof obj['_seconds'] === 'number') {
      const d = new Date(obj['_seconds'] * 1000);
      return isNaN(d.getTime()) ? null : d;
    }
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const num = Number(v);
    if (!isNaN(num)) {
      const d = new Date(num);
      if (!isNaN(d.getTime())) return d;
    }
    const localized = parseLocalizedDate(v);
    if (localized) return localized;
  }
  try {
    const d = new Date(typeof v === 'string' || typeof v === 'number' ? v : String(v));
    return isNaN(d.getTime()) ? null : d;
  } catch { /* ignore */ }
  return null;
}

export function toTimestampMs(v: unknown): number | null {
  const d = toDate(v);
  return d ? d.getTime() : null;
}

export function relativeDate(ts: number): string {
  const now = new Date();
  const date = new Date(ts);
  if (isNaN(date.getTime())) return '';

  // Zero out time part to compare calendar days
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - target.getTime()) / (24 * 60 * 60 * 1000));

  if (diffDays === 0) {
    return 'сегодня';
  }
  if (diffDays === 1) {
    return 'вчера';
  }
  if (diffDays >= 2 && diffDays <= 6) {
    if (diffDays === 5 || diffDays === 6) {
      return `${diffDays} дней назад`;
    }
    return `${diffDays} дня назад`;
  }
  if (diffDays >= 7 && diffDays <= 13) {
    return 'на прошлой неделе';
  }
  if (diffDays >= 14 && diffDays <= 20) {
    return '2 недели назад';
  }
  if (diffDays >= 21 && diffDays <= 27) {
    return '3 недели назад';
  }

  const monthsRu = [
    'январе', 'феврале', 'марте', 'апреле', 'мае', 'июне',
    'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'
  ];

  const monthName = monthsRu[date.getMonth()];
  if (date.getFullYear() === now.getFullYear()) {
    return `в ${monthName}`;
  } else {
    return `в ${monthName} ${date.getFullYear()}`;
  }
}
