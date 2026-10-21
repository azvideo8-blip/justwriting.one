import { createHash } from 'node:crypto';

// E-7: в журнал службы уходит одна строка `[client-error]` без email и без
// текста. Всё, что не входит в белый список, отбрасывается: message, stack и
// context клиента могут содержать текст заметки.
const SAFE_TOKEN = /^[A-Za-z0-9_.:/-]{1,80}$/;
const LEVELS = new Set(['error', 'warning', 'info']);
const MAX_RECORDS = 50;

function token(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_TOKEN.test(value) ? value : undefined;
}

function browserFamily(ua: string): string {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'other';
}

function osFamily(ua: string): string {
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'other';
}

export interface ClientErrorSummary {
  at: string;
  uid: string;
  app: string | undefined;
  browser: string;
  os: string;
  count: number;
  records: Array<{
    action: string | undefined;
    name: string | undefined;
    code: string | undefined;
    level: string;
    time: number | undefined;
  }>;
}

export function clientErrorSummary(uid: string, data: unknown, userAgent: string): ClientErrorSummary {
  const payload = (data ?? {}) as { records?: unknown; appVersion?: unknown };
  const list = Array.isArray(payload.records) ? payload.records.slice(0, MAX_RECORDS) : [];
  const records = list
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map(item => ({
      action: token(item.action),
      name: token(item.name),
      code: token(item.code),
      level: typeof item.level === 'string' && LEVELS.has(item.level) ? item.level : 'error',
      time: typeof item.time === 'number' && Number.isFinite(item.time) ? Math.trunc(item.time) : undefined,
    }));

  return {
    at: new Date().toISOString(),
    uid: createHash('sha256').update(uid).digest('hex').slice(0, 12),
    app: token(payload.appVersion),
    browser: browserFamily(userAgent),
    os: osFamily(userAgent),
    count: records.length,
    records,
  };
}
