import { reportError } from '../../../shared/errors/reportError';
import { getLocalDb } from '../../../core/storage/localDb';
import { purgeNoteDerivatives, type PurgeDerivativesResult } from '../../../core/services/noteDerivativePurge';
import { readJournal, writeJournal } from '../../../core/sync/syncJournal';
import { isExcludedFromAI } from '../utils/isExcludedFromAI';

// EX-1: локальная уборка производных (дайджест/грань/портрет) отказала — пересказ
// скрытой или удалённой заметки остался на устройстве и мог уйти в подсказки ИИ.
// Журнал — на учётку, как облачный (pendingAnalysisDeletes), но свой: облако и
// устройство повторяются по-разному.
//
// Ревью выпуска 0.11.24: запись помнит, какие части упали и были ли производные
// при первой попытке. Повтор переделывает только упавшие части — иначе портрет
// стирался бы на каждом проходе, пока падает другая часть, и у заметки без
// разбора тоже. После MAX_ATTEMPTS запись не снимается (пересказ остался бы
// навсегда), а повторяется раз в сутки.
const PENDING_LOCAL_PURGES_BASE = 'ai_sync_pending_local_purges';
export const MAX_LOCAL_PURGE_ATTEMPTS = 10;
export const LOCAL_PURGE_SLOW_RETRY_MS = 24 * 60 * 60 * 1000;

export interface PendingLocalPurge {
  uid: string;
  documentId: string;
  digest?: boolean;
  facets?: boolean;
  portrait?: boolean;
  /** Первая попытка нашла производные — повтор считает, что они были. */
  assume?: boolean;
  attempts?: number;
  /** После потолка попыток — не раньше этого времени. */
  nextAt?: number;
}

const optBool = (v: unknown) => v === undefined || typeof v === 'boolean';

function isLocalPurgeRow(v: unknown): v is PendingLocalPurge {
  const o = v as Record<string, unknown> | null;
  return o !== null && typeof o === 'object'
    && typeof o.uid === 'string' && typeof o.documentId === 'string'
    && optBool(o.digest) && optBool(o.facets) && optBool(o.portrait) && optBool(o.assume)
    && (o.attempts === undefined || typeof o.attempts === 'number')
    && (o.nextAt === undefined || typeof o.nextAt === 'number');
}

// «не прочитан» ≠ «пуст»: `null` — журнал нечитаем, его не переписываем.
export function readPendingLocalPurges(uid: string): PendingLocalPurge[] | null {
  const res = readJournal(PENDING_LOCAL_PURGES_BASE, uid, isLocalPurgeRow);
  return 'rows' in res && res.dropped === 0 ? res.rows : null;
}

function write(uid: string, list: PendingLocalPurge[], action: string): void {
  if (!writeJournal(PENDING_LOCAL_PURGES_BASE, uid, list)) {
    reportError(new Error('Journal of pending local purges could not be written'), { action }, 'warning');
  }
}

/** Без результата первой попытки — все части, без допущения о производных. */
export function persistPendingLocalPurge(uid: string, documentId: string, purge?: PurgeDerivativesResult): void {
  const list = readPendingLocalPurges(uid);
  if (list === null) {
    reportError(new Error('Journal of pending local purges is unreadable — left as is'), { action: 'persistPendingLocalPurge' }, 'warning');
    return;
  }
  const parts = purge
    ? { digest: purge.digestFailed, facets: purge.facetsFailed, portrait: purge.portraitFailed }
    : { digest: true, facets: true, portrait: true };
  const prev = list.find(d => d.documentId === documentId);
  const row: PendingLocalPurge = {
    uid,
    documentId,
    digest: parts.digest || prev?.digest === true,
    facets: parts.facets || prev?.facets === true,
    portrait: parts.portrait || prev?.portrait === true,
    assume: purge?.hadDerivatives === true || prev?.assume === true,
    attempts: prev?.attempts ?? 0,
  };
  write(uid, [...list.filter(d => d.documentId !== documentId), row], 'persistPendingLocalPurge');
}

/**
 * Заметку вернули в ИИ: снять запись, только если заметка и правда видна ИИ
 * (не в корзине) — или её нет на устройстве (заметка только в облаке: о корзине
 * судить нечем, событие о снятии исключения — единственный ответ).
 */
export async function forgetIfVisibleToAI(uid: string, documentId: string): Promise<void> {
  const db = await getLocalDb(uid);
  const doc = (await db.getAll('documents')).find(d => d.id === documentId || d.linkedCloudId === documentId || d.uuid === documentId);
  if (doc && isExcludedFromAI(doc)) return;
  forgetPendingLocalPurge(uid, documentId);
}

export function forgetPendingLocalPurge(uid: string, documentId: string): void {
  const list = readPendingLocalPurges(uid);
  if (list === null || !list.some(d => d.documentId === documentId)) return;
  write(uid, list.filter(d => d.documentId !== documentId), 'forgetPendingLocalPurge');
}

/**
 * Повтор локальной уборки. Заметка всё ещё скрыта/в корзине или удалена — убираем
 * упавшие части снова; вернули в ИИ — забываем без уборки (производные
 * пересоберутся разбором). Заметку ищем и по облачному номеру: событие о
 * заметке только в облаке несёт его (archiveCrud).
 */
export async function retryPendingLocalPurges(uid: string, now = Date.now()): Promise<{ purged: number; failed: number; forgotten: number; slowed: number }> {
  const res = { purged: 0, failed: 0, forgotten: 0, slowed: 0 };
  const list = readPendingLocalPurges(uid);
  if (!list || list.length === 0) return res;
  const db = await getLocalDb(uid);
  // Одно чтение на проход: заметку ищем по локальному номеру, облачной связи и uuid.
  type Doc = Awaited<ReturnType<typeof db.getAll<'documents'>>>[number];
  const byAnyId = new Map<string, Doc>();
  for (const d of await db.getAll('documents')) {
    for (const k of [d.id, d.linkedCloudId, d.uuid]) if (k) byAnyId.set(k, d);
  }
  for (const item of list) {
    if (item.nextAt !== undefined && item.nextAt > now) continue;
    try {
      const doc = byAnyId.get(item.documentId);
      if (doc && !isExcludedFromAI(doc)) {
        forgetPendingLocalPurge(uid, item.documentId);
        res.forgotten++;
        continue;
      }
      const r = await purgeNoteDerivatives(item.documentId, uid, {
        assumeDerivatives: item.assume === true,
        only: { digest: item.digest === true, facets: item.facets === true, portrait: item.portrait === true },
      });
      const still = { digest: r.digestFailed, facets: r.facetsFailed, portrait: r.portraitFailed };
      if (!still.digest && !still.facets && !still.portrait) {
        forgetPendingLocalPurge(uid, item.documentId);
        res.purged++;
        continue;
      }
      const attempts = (item.attempts ?? 0) + 1;
      const slow = attempts >= MAX_LOCAL_PURGE_ATTEMPTS;
      if (attempts === MAX_LOCAL_PURGE_ATTEMPTS) {
        reportError(new Error('Local derivatives purge keeps failing — retrying daily'), { action: 'retryPendingLocalPurges_slow', documentId: item.documentId, attempts });
      }
      const current = readPendingLocalPurges(uid);
      if (current !== null) {
        write(uid, current.map(d => (d.documentId === item.documentId
          ? { ...d, ...still, attempts, ...(slow ? { nextAt: now + LOCAL_PURGE_SLOW_RETRY_MS } : {}) }
          : d)), 'retryPendingLocalPurges');
      }
      if (slow) res.slowed++;
      res.failed++;
    } catch (e) {
      res.failed++;
      reportError(e, { action: 'retryPendingLocalPurges', documentId: item.documentId });
    }
  }
  return res;
}
