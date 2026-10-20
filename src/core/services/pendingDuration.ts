import { reportError } from '../../shared/errors/reportError';
import { readJournal, writeJournal } from '../sync/syncJournal';

/**
 * W-6: секунды, которые заметка должна облачному счётчику.
 *
 * Онлайн-сохранение сначала пишет ряд версии (`addVersion`), и только потом
 * обновляет счётчики (`updateDocumentAfterSession`). Если второй вызов упал, ряд
 * в облаке уже лежит, задача встаёт в очередь, дренаж считает её уже отправленной
 * и несёт дельту 0 — время сессии в `total_duration` облака не появляется
 * никогда, а следующий забор опускает локальную сумму до облачной. Поэтому долг
 * остаётся здесь и уходит вместе со следующей дельтой этой же заметки.
 *
 * Форма та же, что у журналов pending-удалений (SA-1): маркер ложится на диск до
 * успеха, и пережитое закрытие вкладки не стоит потери.
 *
 * S0-2 (F-3): ключ — на учётку. В общем ключе одна чужая строка делала журнал
 * нечитаемым для всего устройства, а «нечитаемо» здесь читалось как «долга нет».
 */
const PENDING_DURATION_BASE = 'sync_pending_duration';

interface OwedEntry {
  uid: string;
  docId: string;
  seconds: number;
}

let reportedUnreadable = false;

function isOwedRow(v: unknown): v is OwedEntry {
  const o = v as Record<string, unknown> | null;
  return o !== null && typeof o === 'object'
    && typeof o.uid === 'string' && typeof o.docId === 'string'
    && Number.isFinite(o.seconds) && Number(o.seconds) > 0;
}

function readJournalFor(uid: string): OwedEntry[] {
  const res = readJournal(PENDING_DURATION_BASE, uid, isOwedRow);
  if ('rows' in res) return res.rows;
  // Нечитаемый журнал = «долга нет»: худший исход — потерянные секунды, а не
  // удвоенные. Сказать один раз за загрузку страницы.
  if (!reportedUnreadable) {
    reportedUnreadable = true;
    reportError(new Error('Journal of owed session durations is unreadable — read as empty'), { action: 'readOwedDurations' }, 'warning');
  }
  return [];
}

function writeJournalFor(uid: string, list: OwedEntry[]): void {
  if (!writeJournal(PENDING_DURATION_BASE, uid, list)) {
    reportError(new Error('Journal of owed session durations could not be written'), { action: 'writeOwedDurations' }, 'warning');
  }
}

/** Записать долг рядом с уже висящим. Нули и отрицательные значения не пишутся. */
export function oweSessionDuration(uid: string, docId: string, seconds: number): void {
  if (!uid || !docId || !Number.isFinite(seconds) || seconds <= 0) return;
  const list = readJournalFor(uid);
  const entry = list.find(e => e.uid === uid && e.docId === docId);
  if (entry) entry.seconds += seconds;
  else list.push({ uid, docId, seconds });
  writeJournalFor(uid, list);
}

/** Сколько секунд заметка должна облаку прямо сейчас. */
export function owedSessionDuration(uid: string, docId: string): number {
  if (!uid || !docId) return 0;
  return readJournalFor(uid).find(e => e.uid === uid && e.docId === docId)?.seconds ?? 0;
}

/**
 * Погасить ровно то, что ушло в облако. Остаток — долг, наросший, пока был в
 * пути следующий вызов, — остаётся висеть и уйдёт следующей дельтой.
 */
export function settleSessionDuration(uid: string, docId: string, sent: number): void {
  if (!uid || !docId || !Number.isFinite(sent) || sent <= 0) return;
  const list = readJournalFor(uid);
  const entry = list.find(e => e.uid === uid && e.docId === docId);
  if (!entry) return;
  entry.seconds -= sent;
  if (entry.seconds <= 0) list.splice(list.indexOf(entry), 1);
  writeJournalFor(uid, list);
}
