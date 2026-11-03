import { reportError } from '../../shared/errors/reportError';
import { readJournal, writeJournal } from '../sync/syncJournal';

/**
 * S2-7: прибавки счётчиков заметки «в пути» (`sync_push` `delta`, 0047).
 *
 * Прибавка ложится в журнал ДО отправки и снимается только по ответу сервера
 * (`ok`/`duplicate`/`gone`). Таймаут и обрыв — «не знаю»: запись остаётся и
 * уходит снова с тем же `opId`, а сервер по ключу не прибавит второй раз. Это
 * снимает W-6 (таймаут считался «легло» — недосчёт).
 *
 * Нечитаемый журнал — «прибавок нет»: худший исход — потерянные секунды, а не
 * удвоенные (тот же выбор, что у `pendingDuration`).
 */
const PENDING_DELTA_BASE = 'sync_pending_delta';

export interface StatsDelta {
  uid: string;
  docId: string;
  opId: string;
  sessions: number;
  duration: number;
  words: number;
}

let reportedUnreadable = false;

function isDeltaRow(v: unknown): v is StatsDelta {
  const o = v as Record<string, unknown> | null;
  return o !== null && typeof o === 'object'
    && typeof o.uid === 'string' && typeof o.docId === 'string' && typeof o.opId === 'string'
    && Number.isFinite(o.sessions) && Number.isFinite(o.duration) && Number.isFinite(o.words);
}

function readFor(uid: string): StatsDelta[] {
  const res = readJournal(PENDING_DELTA_BASE, uid, isDeltaRow);
  if ('rows' in res) return res.rows;
  if (!reportedUnreadable) {
    reportedUnreadable = true;
    reportError(new Error('Journal of pending stats deltas is unreadable — read as empty'), { action: 'readPendingDeltas' }, 'warning');
  }
  return [];
}

function writeFor(uid: string, list: StatsDelta[]): boolean {
  if (writeJournal(PENDING_DELTA_BASE, uid, list)) return true;
  reportError(new Error('Journal of pending stats deltas could not be written'), { action: 'writePendingDeltas' }, 'warning');
  return false;
}

/**
 * Поставить прибавку в журнал до отправки. Новый `opId` — новая операция.
 * `queued: false` — журнал не записался (квота, запрет хранилища): прибавку
 * отправляют из памяти, а при сбое вызывающий держит её долгом, как до S2-7.
 */
export function queueStatsDelta(uid: string, docId: string, d: { sessions: number; duration: number; words: number }): { entry: StatsDelta; queued: boolean } {
  const entry: StatsDelta = { uid, docId, opId: crypto.randomUUID(), ...d };
  return { entry, queued: writeFor(uid, [...readFor(uid), entry]) };
}

/** Прибавки заметки, ещё не подтверждённые сервером, в порядке постановки. */
export function pendingStatsDeltas(uid: string, docId: string): StatsDelta[] {
  return readFor(uid).filter(e => e.docId === docId);
}

/** Снять подтверждённые сервером прибавки. */
export function clearStatsDeltas(uid: string, opIds: string[]): void {
  if (opIds.length === 0) return;
  const done = new Set(opIds);
  // Не снялись — повтор уйдёт с теми же opId, сервер отбросит их по sync_op_keys;
  // об отказе записи writeFor сообщает сам.
  void writeFor(uid, readFor(uid).filter(e => !done.has(e.opId))); // намеренно: повтор безопасен
}

/**
 * Ошибка, после которой прибавка уже в журнале: вызывающий не должен класть её
 * секунды долгом ещё раз (`pendingDuration`), иначе следующая выгрузка удвоит их.
 */
const queuedErrors = new WeakSet<object>();

export function markStatsDeltaQueued(e: unknown): void {
  if (typeof e === 'object' && e !== null) queuedErrors.add(e);
}

export function isStatsDeltaQueued(e: unknown): boolean {
  return typeof e === 'object' && e !== null && queuedErrors.has(e);
}
