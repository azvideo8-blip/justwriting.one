import { reportError } from '../../../shared/errors/reportError';
import { DataProvider } from '../../../core/data';
import { getCurrentUser } from '../../../core/auth';

const PENDING_ANALYSIS_DELETES_LS_KEY = 'ai_sync_pending_analysis_deletes';

export interface PersistedAnalysisDelete {
  uid: string;
  canonicalId: string;
}

export function readPersistedAnalysisDeletes(): PersistedAnalysisDelete[] {
  try {
    const raw = localStorage.getItem(PENDING_ANALYSIS_DELETES_LS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as PersistedAnalysisDelete[]) : [];
  } catch {
    return [];
  }
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
  if (!list.some(d => d.uid === uid && d.canonicalId === canonicalId)) {
    list.push({ uid, canonicalId });
    writePersistedAnalysisDeletes(list);
  }
}

export function forgetPendingAnalysisDelete(uid: string, canonicalId: string): void {
  writePersistedAnalysisDeletes(
    readPersistedAnalysisDeletes().filter(d => !(d.uid === uid && d.canonicalId === canonicalId))
  );
}

export function getPendingAnalysisDeleteKeys(uid: string): Set<string> {
  return new Set(readPersistedAnalysisDeletes().filter(d => d.uid === uid).map(d => d.canonicalId));
}

export async function retryPendingAnalysisDeletes(uid?: string): Promise<{ deleted: number; failed: number }> {
  const user = uid ?? getCurrentUser()?.uid;
  if (!user || user.startsWith('guest_')) return { deleted: 0, failed: 0 };
  const all = readPersistedAnalysisDeletes().filter(d => d.uid === user);
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
