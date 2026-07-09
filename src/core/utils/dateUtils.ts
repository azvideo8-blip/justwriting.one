import { ru } from 'date-fns/locale/ru';
import { enUS } from 'date-fns/locale/en-US';

type DateFnsLocale = import('date-fns/locale').Locale;

export function getDateLocale(lang: string): DateFnsLocale {
  return lang === 'ru' ? ru : enUS;
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
