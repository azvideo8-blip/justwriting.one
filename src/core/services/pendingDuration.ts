import { reportError } from '../../shared/errors/reportError';

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
 */
const LS_KEY = 'sync_pending_duration';

interface OwedEntry {
  uid: string;
  docId: string;
  seconds: number;
}

let reportedUnreadable = false;

function readJournal(): OwedEntry[] {
  let raw: string | null;
  try { raw = localStorage.getItem(LS_KEY); } catch { return []; }
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) throw new Error('not an array');
    return (parsed as OwedEntry[]).filter(e =>
      e !== null && typeof e.uid === 'string' && typeof e.docId === 'string'
      && Number.isFinite(e.seconds) && e.seconds > 0);
  } catch {
    // Нечитаемый журнал = «долга нет»: худший исход — потерянные секунды, а не
    // удвоенные. Сказать один раз за загрузку страницы.
    if (!reportedUnreadable) {
      reportedUnreadable = true;
      reportError(new Error('Journal of owed session durations is unreadable — read as empty'), { action: 'readOwedDurations' }, 'warning');
    }
    return [];
  }
}

function writeJournal(list: OwedEntry[]): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); }
  catch (e) { reportError(e, { action: 'writeOwedDurations' }, 'warning'); }
}

/** Записать долг рядом с уже висящим. Нули и отрицательные значения не пишутся. */
export function oweSessionDuration(uid: string, docId: string, seconds: number): void {
  if (!uid || !docId || !Number.isFinite(seconds) || seconds <= 0) return;
  const list = readJournal();
  const entry = list.find(e => e.uid === uid && e.docId === docId);
  if (entry) entry.seconds += seconds;
  else list.push({ uid, docId, seconds });
  writeJournal(list);
}

/** Сколько секунд заметка должна облаку прямо сейчас. */
export function owedSessionDuration(uid: string, docId: string): number {
  if (!uid || !docId) return 0;
  return readJournal().find(e => e.uid === uid && e.docId === docId)?.seconds ?? 0;
}

/**
 * Погасить ровно то, что ушло в облако. Остаток — долг, наросший, пока был в
 * пути следующий вызов, — остаётся висеть и уйдёт следующей дельтой.
 */
export function settleSessionDuration(uid: string, docId: string, sent: number): void {
  if (!uid || !docId || !Number.isFinite(sent) || sent <= 0) return;
  const list = readJournal();
  const entry = list.find(e => e.uid === uid && e.docId === docId);
  if (!entry) return;
  entry.seconds -= sent;
  if (entry.seconds <= 0) list.splice(list.indexOf(entry), 1);
  writeJournal(list);
}
