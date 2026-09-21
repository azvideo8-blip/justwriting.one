import { useActivityLogStore, type ActivityLevel } from '../../../shared/activity/useActivityLogStore';

export type AIDegradationCategory = 'daily_limit' | 'transient' | 'misconfiguration' | 'server_error';

export interface AIDegradationParams {
  feature: string;
  cause: unknown;
  action?: string;
  impact?: string;
}

// In-memory session tracking: maps causeCategory -> activity log entry ID.
// Deduplication is by cause only (not per feature), so when the daily limit
// is reached, multiple failing features increment the count of one entry instead
// of producing 9 separate log messages.
const sessionReportedCauses = new Map<AIDegradationCategory, string>();

export function resetAIDegradationSession(): void {
  sessionReportedCauses.clear();
}

export function isDailyLimitError(cause: unknown): boolean {
  if (!cause) return false;
  if (typeof cause === 'string') {
    const lower = cause.toLowerCase();
    return cause === 'DAILY_LIMIT' || (lower.includes('daily limit') && !lower.includes('rate limit'));
  }
  if (typeof cause === 'object') {
    const c = cause as { code?: string; message?: string; details?: { errorType?: string } };
    if (c.code === 'DAILY_LIMIT') return true;
    if (c.details?.errorType === 'DAILY_LIMIT') return true;
    const msg = (c.message || '').toLowerCase();
    return msg.includes('daily limit') && !msg.includes('rate limit');
  }
  return false;
}

export function classifyCause(cause: unknown): { category: AIDegradationCategory; code: string } {
  if (isDailyLimitError(cause)) {
    return { category: 'daily_limit', code: 'DAILY_LIMIT' };
  }

  let code = 'UNKNOWN';
  let message = '';
  if (typeof cause === 'string') {
    code = cause;
    message = cause;
  } else if (cause && typeof cause === 'object') {
    const err = cause as { code?: string; message?: string };
    code = err.code || 'UNKNOWN';
    message = err.message || '';
  }

  const normCode = code.toLowerCase();
  const normMsg = message.toLowerCase();

  // Transient network / upstream / provider outages / rate limits
  if (
    code === 'NETWORK' || code === 'UPSTREAM' || code === 'RATE_LIMIT' ||
    normCode.includes('deadline') || normCode.includes('unavailable') || normCode.includes('timeout') || normCode.includes('rate_limit') ||
    normMsg.includes('timeout') || normMsg.includes('network') || normMsg.includes('unavailable') || normMsg.includes('rate limit') ||
    (typeof navigator !== 'undefined' && navigator.onLine === false)
  ) {
    return { category: 'transient', code: code !== 'UNKNOWN' ? code : 'RATE_LIMIT' };
  }

  // Misconfiguration / authorization issues
  if (
    code === 'AUTH_REQUIRED' || code === 'MISCONFIGURED' ||
    normCode.includes('unauthenticated') || normCode.includes('permission') ||
    normMsg.includes('auth') || normMsg.includes('unauthorized') || normMsg.includes('401')
  ) {
    return { category: 'misconfiguration', code: code !== 'UNKNOWN' ? code : 'MISCONFIGURED' };
  }

  return { category: 'server_error', code: code !== 'UNKNOWN' ? code : 'SERVER_ERROR' };
}

export function reportAIDegradation(params: AIDegradationParams): void {
  const { category, code } = classifyCause(params.cause);
  const store = useActivityLogStore.getState();

  const existingEntryId = sessionReportedCauses.get(category);
  if (existingEntryId) {
    const existingEntry = store.entries.find(e => e.id === existingEntryId);
    if (existingEntry) {
      store.updateEntry(existingEntryId, {
        count: existingEntry.count + 1,
        time: Date.now(),
      });
      return;
    }
  }

  let message: string;
  let level: ActivityLevel;

  switch (category) {
    case 'daily_limit':
      message = 'Дневной лимит ИИ исчерпан: функции ИИ временно ограничены до завтра (реранжирование, поиск заметок в чате, построение профиля)';
      level = 'error';
      break;
    case 'transient':
      message = 'Временный сбой сервиса ИИ: запрос выполнен в базовом режиме (повторите позже)';
      level = 'warning';
      break;
    case 'misconfiguration':
      message = `Ошибка конфигурации или авторизации ИИ (${code}): функции ИИ недоступны`;
      level = 'error';
      break;
    case 'server_error':
    default:
      message = 'Сбой сервиса ИИ: запрос выполнен в базовом режиме';
      level = 'error';
      break;
  }

  const newId = store.addActivity(
    message,
    {
      cause: code,
      category,
      feature: params.feature,
      action: params.action,
      impact: params.impact,
    },
    level,
    'ai'
  );

  sessionReportedCauses.set(category, newId);
}
