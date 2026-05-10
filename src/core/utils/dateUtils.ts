import { ru, enUS } from 'date-fns/locale';

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
  }
  try {
    const d = new Date(v as string | number);
    return isNaN(d.getTime()) ? null : d;
  } catch { /* ignore */ }
  return null;
}

export function toTimestampMs(v: unknown): number | null {
  const d = toDate(v);
  return d ? d.getTime() : null;
}

export function getDateLocale(lang: string) {
  return lang === 'ru' ? ru : enUS;
}
