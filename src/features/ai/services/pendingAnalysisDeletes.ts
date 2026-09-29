import { reportError } from '../../../shared/errors/reportError';
import { DataProvider } from '../../../core/data';
import { getCurrentUser } from '../../../core/auth';

const PENDING_ANALYSIS_DELETES_LS_KEY = 'ai_sync_pending_analysis_deletes';

export interface PersistedAnalysisDelete {
  uid: string;
  canonicalId: string;
}

let reportedUnreadable = false;

// R3-012: «не прочитан» ≠ «пуст» (правило A-5 журнала удалений AI-сторов).
// Прежний `catch { return [] }` давал persist'у переписать журнал одним новым
// элементом — прежние облачные удаления терялись молча. `null` — не читается.
export function readPersistedAnalysisDeletes(): PersistedAnalysisDelete[] | null {
  try {
    const raw = localStorage.getItem(PENDING_ANALYSIS_DELETES_LS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) return parsed as PersistedAnalysisDelete[];
  } catch { /* ниже */ }
  if (!reportedUnreadable) {
    reportedUnreadable = true;
    reportError(new Error('Journal of pending analysis deletions is unreadable — left as is'), { action: 'readPersistedAnalysisDeletes' }, 'warning');
  }
  return null;
}

export function writePersistedAnalysisDeletes(list: PersistedAnalysisDelete[]): void {
  try {
    localStorage.setItem(PENDING_ANALYSIS_DELETES_LS_KEY, JSON.stringify(list));
  } catch (e) {
    reportError(e, { action: 'writePersistedAnalysisDeletes' }, 'warning');
  }
}

export function persistPendingAnalysisDelete(uid: string, canonicalId: string): void {
  const list = readPersistedAnalysisDeletes();
  if (list === null) return;
  if (!list.some(d => d.uid === uid && d.canonicalId === canonicalId)) {
    list.push({ uid, canonicalId });
    writePersistedAnalysisDeletes(list);
  }
}

export function forgetPendingAnalysisDelete(uid: string, canonicalId: string): void {
  const list = readPersistedAnalysisDeletes();
  if (list === null) return;
  writePersistedAnalysisDeletes(list.filter(d => !(d.uid === uid && d.canonicalId === canonicalId)));
}

/** `null` — журнал не читается: восстановлению не знать, что пользователь уже удалил. */
export function getPendingAnalysisDeleteKeys(uid: string): Set<string> | null {
  const list = readPersistedAnalysisDeletes();
  return list === null ? null : new Set(list.filter(d => d.uid === uid).map(d => d.canonicalId));
}

export async function retryPendingAnalysisDeletes(uid?: string): Promise<{ deleted: number; failed: number }> {
  const user = uid ?? getCurrentUser()?.uid;
  if (!user || user.startsWith('guest_')) return { deleted: 0, failed: 0 };
  const all = (readPersistedAnalysisDeletes() ?? []).filter(d => d.uid === user);
  let deleted = 0;
  let failed = 0;
  for (const item of all) {
    try {
      await DataProvider.deleteSummary(item.uid, item.canonicalId);
      await DataProvider.deleteEmbedding(item.uid, item.canonicalId);
      forgetPendingAnalysisDelete(item.uid, item.canonicalId);
      deleted++;
    } catch (e) {
      failed++;
      reportError(e, { action: 'retryPendingAnalysisDeletes', canonicalId: item.canonicalId });
    }
  }
  return { deleted, failed };
}
