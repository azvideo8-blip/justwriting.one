import { getIdToken } from '../../../core/auth';
import type { ActivityLogItem } from '../../../shared/activity/useActivityLogStore';

export interface ClientErrorRecord {
  action?: string | undefined;
  name?: string | undefined;
  code?: string | undefined;
  level: 'error' | 'warning' | 'info';
  time: number;
}

/**
 * E-7: из журнала активности берём только безопасные поля. message и context
 * не покидают устройство: там бывает текст заметки.
 */
export function activityToClientErrorRecords(entries: ActivityLogItem[]): ClientErrorRecord[] {
  return entries.slice(0, 50).map(entry => ({
    action: entry.source,
    level: entry.level === 'success' ? 'info' : entry.level,
    time: entry.time,
  }));
}

/**
 * E-7: отчёт уходит только по нажатию человека.
 */
export async function sendClientErrorReport(records: ClientErrorRecord[], appVersion: string): Promise<void> {
  const token = await getIdToken();
  if (!token) throw new Error('AUTH_REQUIRED');
  const res = await fetch('/api/client-error', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ records: records.slice(0, 50), appVersion }),
  });
  if (!res.ok) {
    throw Object.assign(new Error(`client-error report failed: ${res.status}`), { status: res.status });
  }
}
