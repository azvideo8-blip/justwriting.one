import { reportError } from '../../../shared/errors/reportError';
import { DataProvider } from '../../../core/data';
import { getCurrentUser } from '../../../core/auth';
import { currentJournalUid, readJournal, writeJournal } from '../../../core/sync/syncJournal';

// S0-2 (F-3): журнал — на учётку, как и остальные журналы ИИ-синка. Общий ключ
// означал, что одна битая строка чужого аккаунта закрывает забор и повтор
// удалений всем аккаунтам устройства.
const PENDING_ANALYSIS_DELETES_BASE = 'ai_sync_pending_analysis_deletes';

export interface PersistedAnalysisDelete {
  uid: string;
  canonicalId: string;
}

let reportedUnreadable = false;

function isAnalysisDeleteRow(v: unknown): v is PersistedAnalysisDelete {
  const o = v as Record<string, unknown> | null;
  return o !== null && typeof o === 'object'
    && typeof o.uid === 'string' && typeof o.canonicalId === 'string';
}

// R3-012: «не прочитан» ≠ «пуст» (правило A-5 журнала удалений AI-сторов).
// Прежний `catch { return [] }` давал persist'у переписать журнал одним новым
// элементом — прежние облачные удаления терялись молча. `null` — не читается.
export function readPersistedAnalysisDeletes(uid?: string | null): PersistedAnalysisDelete[] | null {
  const target = uid === undefined ? currentJournalUid() : uid;
  const res = readJournal(PENDING_ANALYSIS_DELETES_BASE, target, isAnalysisDeleteRow);
  if ('rows' in res && res.dropped === 0) return res.rows;
  if (!reportedUnreadable) {
    reportedUnreadable = true;
    reportError(new Error('Journal of pending analysis deletions is unreadable — left as is'), { action: 'readPersistedAnalysisDeletes' }, 'warning');
  }
  return null;
}

export function writePersistedAnalysisDeletes(list: PersistedAnalysisDelete[], uid?: string | null): void {
  const target = uid === undefined ? currentJournalUid() : uid;
  if (!writeJournal(PENDING_ANALYSIS_DELETES_BASE, target, list)) {
    reportError(new Error('Journal of pending analysis deletions could not be written'), { action: 'writePersistedAnalysisDeletes' }, 'warning');
  }
}

export function persistPendingAnalysisDelete(uid: string, canonicalId: string): void {
  const list = readPersistedAnalysisDeletes(uid);
  if (list === null) return;
  if (!list.some(d => d.uid === uid && d.canonicalId === canonicalId)) {
    list.push({ uid, canonicalId });
    writePersistedAnalysisDeletes(list, uid);
  }
}

export function forgetPendingAnalysisDelete(uid: string, canonicalId: string): void {
  const list = readPersistedAnalysisDeletes(uid);
  if (list === null) return;
  writePersistedAnalysisDeletes(list.filter(d => !(d.uid === uid && d.canonicalId === canonicalId)), uid);
}

/** `null` — журнал не читается: восстановлению не знать, что пользователь уже удалил. */
export function getPendingAnalysisDeleteKeys(uid: string): Set<string> | null {
  const list = readPersistedAnalysisDeletes(uid);
  return list === null ? null : new Set(list.filter(d => d.uid === uid).map(d => d.canonicalId));
}

export async function retryPendingAnalysisDeletes(uid?: string): Promise<{ deleted: number; failed: number }> {
  const user = uid ?? getCurrentUser()?.uid;
  if (!user || user.startsWith('guest_')) return { deleted: 0, failed: 0 };
  const all = (readPersistedAnalysisDeletes(user) ?? []).filter(d => d.uid === user);
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
