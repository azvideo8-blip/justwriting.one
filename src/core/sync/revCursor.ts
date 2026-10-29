import { getLocalDb, syncRevCursorKey } from '../storage/localDb';
import { reportError } from '../../shared/errors/reportError';

/**
 * S1-5: курсор забора «всё после номера N» — на каждую таблицу свой и на
 * каждый аккаунт свой.
 *
 * Почему на таблицу: видимое множество строк каждой таблицы — свой префикс по
 * `rev`; общий курсор на две таблицы, прочитанные двумя запросами в разных
 * снимках, пропускает строки (документы прочитаны до N, версии — после N+1,
 * курсор сдвинут по версиям, а новые документы до N не забраны никогда).
 *
 * Почему в IndexedDB аккаунта, а не localStorage: S0-6 держит синк без
 * localStorage; ключ содержит uid, поэтому чужой аккаунт на этом устройстве
 * курсор не видит. Отдельная запись в сторе `profile` — без подъёма
 * DB_VERSION: откат клиента на 0.10.x не должен упираться в VersionError.
 *
 * Курсор двигает только тот, кто применил строки. Нечитаемый курсор — забор с
 * нуля (полный), а не «пропустить»: потерянная запись хуже лишнего чтения.
 */

export interface SyncRevCursor {
  documents: number;
  versions: number;
}

const ZERO: SyncRevCursor = { documents: 0, versions: 0 };

/**
 * S1-12: строка, которую забор отложил — стойко нечитаемая (схема,
 * расшифровка, заметка без версий). Курсор её прошёл; каждый забор
 * перечитывает отложенные по uuid, пока строка не станет читаемой или не
 * придёт надгробие. Сеть, LOCKED и сбой посреди страницы сюда не попадают —
 * это стоп, как раньше.
 */
export interface SyncRevDeferredRow {
  uuid: string;
  rev: number;
  reason: string;
}

// R-7: порча списка отложенных — не «пусто»: курсор их уже прошёл, и молча
// забытая строка потеряна навсегда. Нечитаемый список читается как нечитаемый
// курсор (getSyncRevCursor → забор с нуля), как у parseCursor.
function parseDeferred(record: unknown): { rows: SyncRevDeferredRow[]; readable: boolean } {
  const raw = (record as { syncRevDeferred?: unknown } | undefined)?.syncRevDeferred;
  if (raw === undefined) return { rows: [], readable: true };
  if (!Array.isArray(raw)) return { rows: [], readable: false };
  const out: SyncRevDeferredRow[] = [];
  for (const item of raw) {
    const r = item as { uuid?: unknown; rev?: unknown; reason?: unknown } | null;
    if (r && typeof r.uuid === 'string' && r.uuid !== '' && typeof r.rev === 'number' && Number.isSafeInteger(r.rev)) {
      out.push({ uuid: r.uuid, rev: r.rev, reason: typeof r.reason === 'string' ? r.reason : '' });
    } else {
      return { rows: [], readable: false };
    }
  }
  return { rows: out, readable: true };
}

/** Запись-курсор целиком: курсор и отложенные живут в одной записи, и любая
 *  запись одного поля обязана сохранить другое. */
function cursorRecord(key: string, existing: unknown, patch: { syncRevCursor?: SyncRevCursor; syncRevDeferred?: SyncRevDeferredRow[] }) {
  const base = (existing && typeof existing === 'object') ? existing as Record<string, unknown> : {
    guestId: key, totalWords: 0, sessionsCount: 0, totalDuration: 0, lastSessionAt: 0,
  };
  return { ...base, guestId: key, ...patch };
}

function parseCursor(record: unknown): { cursor: SyncRevCursor; readable: boolean } {
  const raw = (record as { syncRevCursor?: unknown } | undefined)?.syncRevCursor;
  // R11-5: запись только с отложенными (первый забор отложил строку раньше, чем
  // двинул курсор) — это «курсора ещё нет», а не порча: без предупреждения.
  if (raw === undefined) {
    const deferredOnly = (record as { syncRevDeferred?: unknown } | undefined)?.syncRevDeferred !== undefined;
    return { cursor: { ...ZERO }, readable: record === undefined || deferredOnly };
  }
  if (typeof raw !== 'object' || raw === null) return { cursor: { ...ZERO }, readable: false };
  const documents = (raw as { documents?: unknown }).documents;
  const versions = (raw as { versions?: unknown }).versions;
  if (
    typeof documents !== 'number' || !Number.isSafeInteger(documents) || documents < 0
    || typeof versions !== 'number' || !Number.isSafeInteger(versions) || versions < 0
  ) {
    return { cursor: { ...ZERO }, readable: false };
  }
  return { cursor: { documents, versions }, readable: true };
}

export async function getSyncRevCursor(userId: string): Promise<SyncRevCursor> {
  const db = await getLocalDb(userId);
  const record = await db.get('profile', syncRevCursorKey(userId));
  const { cursor, readable } = parseCursor(record);
  if (!readable) {
    reportError(
      new Error('SYNC_REV_CURSOR_UNREADABLE: starting a full pull'),
      { action: 'getSyncRevCursor_unreadable', userId },
      'warning',
    );
    return cursor;
  }
  // R-7: отложенные не читаются — курсор им не верит: с нуля, иначе строки,
  // которые курсор прошёл с отметкой «отложено», не приедут никогда.
  if (!parseDeferred(record).readable) {
    reportError(
      new Error('SYNC_REV_DEFERRED_UNREADABLE: starting a full pull'),
      { action: 'getSyncRevCursor_deferredUnreadable', userId },
      'warning',
    );
    return { ...ZERO };
  }
  return cursor;
}

/** Сдвинуть курсор таблицы вперёд. Назад не двигает: две параллельные записи
 *  не должны откатить уже применённое (чтение и запись — одна транзакция). */
export async function advanceSyncRevCursor(
  userId: string,
  table: keyof SyncRevCursor,
  rev: number,
): Promise<void> {
  if (!Number.isSafeInteger(rev) || rev < 0) {
    throw new Error(`SYNC_REV_CURSOR_INVALID: ${String(rev)}`);
  }
  const db = await getLocalDb(userId);
  const tx = db.transaction('profile', 'readwrite');
  const key = syncRevCursorKey(userId);
  const existing = await tx.store.get(key);
  const { cursor } = parseCursor(existing);
  if (rev <= cursor[table]) {
    await tx.done;
    return;
  }
  await tx.store.put(cursorRecord(key, existing, { syncRevCursor: { ...cursor, [table]: rev } }) as never);
  await tx.done;
}

export async function getSyncRevDeferred(userId: string): Promise<SyncRevDeferredRow[]> {
  const db = await getLocalDb(userId);
  const { rows, readable } = parseDeferred(await db.get('profile', syncRevCursorKey(userId)));
  if (!readable) {
    reportError(
      new Error('SYNC_REV_DEFERRED_UNREADABLE: deferred list dropped, cursor restarts'),
      { action: 'getSyncRevDeferred_unreadable', userId },
      'warning',
    );
  }
  return rows;
}

export async function setSyncRevDeferred(userId: string, rows: SyncRevDeferredRow[]): Promise<void> {
  const db = await getLocalDb(userId);
  const tx = db.transaction('profile', 'readwrite');
  const key = syncRevCursorKey(userId);
  const existing = await tx.store.get(key);
  await tx.store.put(cursorRecord(key, existing, { syncRevDeferred: rows }) as never);
  await tx.done;
}

export async function clearSyncRevCursor(userId: string): Promise<void> {
  const db = await getLocalDb(userId);
  await db.delete('profile', syncRevCursorKey(userId));
}

/**
 * Ревью 0.11.0 (R11-1): забор по rev — один на аккаунт во всём браузере, а не
 * только в своей вкладке (`_activePullPromises`). Две вкладки читали список
 * отложенных каждая себе и записывали его целиком: строка, отложенная одной,
 * пропадала из списка после записи другой, а курсор уже прошёл её. Вторая
 * вкладка ждёт и потом читает курсор и список заново.
 * Без Web Locks (старый браузер, тесты) — как раньше, без замка.
 */
export function withSyncRevPullLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks?.request) return fn();
  return locks.request(`jw-sync-rev-pull:${userId}`, () => fn()) as Promise<T>;
}
