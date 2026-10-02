import { getLocalDb } from '../storage/localDb';
import type { AIDialogue } from '../storage/localDb';
import { DIALOGUE_SCHEMA, dialogueFingerprint, mergeDialogues, withMessageIds } from '../storage/dialogueMerge';
import { DataProvider } from '../data';
import { getCurrentUser } from '../auth';
import { maybeEncrypt, maybeDecrypt, getEncryptionEnabled } from '../crypto/cryptoHelpers';
import { getSessionKey } from '../crypto/encrypt';
import { cloudSyncEnabled } from '../sync/cloudSyncEnabled';
import { reportError } from '../../shared/errors/reportError';
import { logger } from '../../shared/errors/logger';
import { useActivityLogStore } from '../../shared/activity/useActivityLogStore';
import { selectCloudVersion, type CloudRow } from './localStorePages';

export const SUPPORTED_LOCAL_STORES = [
  'aiPortrait',
  'aiProfileFacets',
  'aiDialogues',
  'aiDialogueEvents',
  'aiChatMemory',
  'lifeStory',
  'aiThemeLedger',
  'aiTimeline',
  'aiBeliefs',
  'aiBeliefRejections',
  'aiCommitments',
  'aiMonthlyDigest',
  'aiThreads',
  'aiPersonas',
] as const;

export type SupportedLocalStoreName = typeof SUPPORTED_LOCAL_STORES[number];

/**
 * SYNC-4: Size threshold for single-row vs paged sync.
 * Records <= 500 KB plaintext travel as a single row.
 * Records > 500 KB plaintext are split into pages of <= 500 KB each.
 */
export const PAGE_SPLIT_THRESHOLD_BYTES = 500 * 1024; // 500 KB

/** Страниц в одном запросе: 8 × 500 КБ после шифрования (~×1.4) ≈ 5.6 МБ < 10 МБ nginx. */
export const PAGES_PER_REQUEST = 8;
/**
 * SYNC-4: предел записи — столько, сколько уходит ОДНИМ запросом (8 × 500 КБ ≈ 4 МБ
 * открытого текста). Все страницы записи пишутся одной транзакцией; при
 * пределе 10 МБ запись крупнее уходила несколькими, и сбой между ними
 * оставлял в облаке смесь версий (R3-013). На проде 2026-09-30 самая большая
 * запись — 3 страницы. Крупнее — остаётся на устройстве с отметкой.
 */
export const MAX_LOCAL_RECORD_BYTES = PAGES_PER_REQUEST * PAGE_SPLIT_THRESHOLD_BYTES;
/** Восстановление принимает и то, что прежние версии выгрузили с пределом 10 МБ. */
export const MAX_RESTORE_RECORD_BYTES = 10 * 1024 * 1024;

export function splitStringIntoChunks(str: string, maxBytesPerChunk = PAGE_SPLIT_THRESHOLD_BYTES): string[] {
  const encoder = new TextEncoder();
  const totalBytes = encoder.encode(str).length;
  if (totalBytes <= maxBytesPerChunk) {
    return [str];
  }

  const chunks: string[] = [];
  const ratio = str.length / totalBytes;
  let startChar = 0;

  while (startChar < str.length) {
    let endChar = Math.min(str.length, startChar + Math.floor(maxBytesPerChunk * ratio));
    if (endChar <= startChar) endChar = startChar + 1;

    let chunk = str.slice(startChar, endChar);
    let chunkBytes = encoder.encode(chunk).length;

    if (chunkBytes > maxBytesPerChunk) {
      while (chunkBytes > maxBytesPerChunk && endChar > startChar + 1) {
        endChar--;
        chunk = str.slice(startChar, endChar);
        chunkBytes = encoder.encode(chunk).length;
      }
    } else {
      while (endChar < str.length) {
        const nextChar = endChar + 1;
        const testChunk = str.slice(startChar, nextChar);
        if (encoder.encode(testChunk).length > maxBytesPerChunk) {
          break;
        }
        endChar = nextChar;
        chunk = testChunk;
      }
    }

    // Не резать суррогатную пару: половинка эмодзи на краю страницы становится
    // U+FFFD уже при шифровании, и облачная копия теряет символ (R3-014).
    if (endChar < str.length && endChar - startChar > 1 && /[\uD800-\uDBFF]/.test(str[endChar - 1] ?? '')) {
      endChar--;
      chunk = str.slice(startChar, endChar);
    }

    chunks.push(chunk);
    startChar = endChar;
  }

  return chunks;
}

// EA-5: облачное удаление производных ИИ (разбор, векторы и т.п. удалённой
// заметки) нельзя вывести заново из IndexedDB — локальная запись уже удалена.
// Держать его только в памяти значило терять при закрытии вкладки (а при
// выключенной синхронизации — всю сессию), и ежедневное восстановление
// возвращало удалённое. Поэтому ожидающие удаления лежат на диске до успеха.
const PENDING_DELETES_LS_KEY = 'ai_sync_pending_deletes';
const CORRUPT_DELETES_BACKUP_PREFIX = 'ai_sync_pending_deletes.corrupt.';

export interface PersistedDelete { uid: string; store: string; key: string }

let hasReportedJournalUnknownThisPageLoad = false;

export function _resetReportedForTests(): void {
  hasReportedJournalUnknownThisPageLoad = false;
}

export function readPersistedDeletesRaw(): { raw: string | null } | { unavailable: true } {
  try {
    return { raw: localStorage.getItem(PENDING_DELETES_LS_KEY) };
  } catch {
    return { unavailable: true };
  }
}

export function parseDeleteJournal(raw: string): { list: PersistedDelete[]; dropped: number } | { corrupt: true } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { corrupt: true };
  }
  if (!Array.isArray(parsed)) {
    return { corrupt: true };
  }
  const list: PersistedDelete[] = [];
  let dropped = 0;
  for (const item of parsed) {
    if (
      item !== null &&
      typeof item === 'object' &&
      typeof (item as Record<string, unknown>).uid === 'string' &&
      typeof (item as Record<string, unknown>).store === 'string' &&
      typeof (item as Record<string, unknown>).key === 'string'
    ) {
      list.push({
        uid: (item as PersistedDelete).uid,
        store: (item as PersistedDelete).store,
        key: (item as PersistedDelete).key,
      });
    } else {
      dropped++;
    }
  }
  return { list, dropped };
}

export function healCorruptDeleteJournal(
  raw: string,
  uid?: string,
): { salvaged: PersistedDelete[]; dropped: number } {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CORRUPT_DELETES_BACKUP_PREFIX)) {
        keysToRemove.push(k);
      }
    }
    for (const k of keysToRemove) {
      localStorage.removeItem(k);
    }
    // R4-019: бэкап нигде не читается и затирался следующим heal молча. Остался
    // вариант «удалить с названным числом» — пусть потеря хотя бы видна в отчёте.
    if (keysToRemove.length > 0) {
      reportError(new Error('Stale unreadable delete-journal backups wiped'), { action: 'healCorruptDeleteJournal_staleBackups', count: keysToRemove.length }, 'warning');
    }
    localStorage.setItem(`${CORRUPT_DELETES_BACKUP_PREFIX}${Date.now()}`, raw);
  } catch (err) {
    reportError(err, { action: 'healCorruptDeleteJournal_backup' }, 'warning');
  }

  const parsed = parseDeleteJournal(raw);
  const salvaged = 'corrupt' in parsed ? [] : parsed.list;
  const dropped = 'corrupt' in parsed ? 0 : parsed.dropped;

  try {
    localStorage.setItem(PENDING_DELETES_LS_KEY, JSON.stringify(salvaged));
  } catch (err) {
    reportError(err, { action: 'healCorruptDeleteJournal_writeSalvaged' }, 'warning');
  }

  reportDeleteJournalUnknown('flushPending_deleteJournalUnknown', uid, {
    rawLength: raw.length,
    salvaged: salvaged.length,
    dropped,
  });

  return { salvaged, dropped };
}

// A-5 (R2-012): «пусто» и «не прочитано» — разные состояния. Пустой журнал
// означает, что удалять в облаке нечего; нечитаемый (строка из другой версии
// приложения, отключённый storage, Safari в приватном режиме) — что мы этого не
// знаем. Сведение второго к первому через `catch { return [] }` позволяло
// дренажу upsert'ом вернуть в облако запись, которую пользователь уже снёс:
// `null` — «журнал не читается», `[]` — «прочитан и пуст».
// F-2: битый JSON в работающем storage исцеляется (бэкап + спасение валидных),
// а на проходе обнаружения возвращается null (fail closed для этого прохода).
export function readPersistedDeletes(): PersistedDelete[] | null {
  const rawRes = readPersistedDeletesRaw();
  if ('unavailable' in rawRes) return null;
  if (rawRes.raw === null) return [];
  const parsed = parseDeleteJournal(rawRes.raw);
  if ('corrupt' in parsed || parsed.dropped > 0) return null;
  return parsed.list;
}

/** Причина, по которой проход останавливает загрузки: её надо назвать вслух. */
function reportDeleteJournalUnknown(
  action: string,
  uid?: string,
  counts?: { rawLength: number; salvaged: number; dropped: number },
): void {
  if (hasReportedJournalUnknownThisPageLoad) return;
  hasReportedJournalUnknownThisPageLoad = true;
  reportError(
    new Error('Journal of pending AI-store deletions is unreadable — what must not be uploaded is unknown'),
    {
      action,
      ...(uid ? { userId: uid } : {}),
      ...(counts ?? {}),
    },
    'warning',
  );
}

function writePersistedDeletes(list: PersistedDelete[]): void {
  // Не записалось — после перезагрузки удаление в облаке забудется, и разбор
  // останется там. Молчать об этом нельзя.
  try { localStorage.setItem(PENDING_DELETES_LS_KEY, JSON.stringify(list)); } catch (e) { reportError(e, { action: 'writePersistedDeletes' }, 'warning'); }
}

function persistDelete(uid: string, store: string, key: string): void {
  const list = readPersistedDeletes();
  // Перечитать нечего — значит и дописать нельзя: запись одного нового
  // обязательства стёрла бы все прежние, а их нельзя вывести заново.
  if (list === null) return reportDeleteJournalUnknown('persistDelete_deleteJournalUnknown', uid);
  if (!list.some(d => d.uid === uid && d.store === store && d.key === key)) {
    list.push({ uid, store, key });
    writePersistedDeletes(list);
  }
}

function forgetPersistedDelete(uid: string, store: string, key: string): void {
  forgetPersistedDeletes(uid, [{ store, key }]);
}

function forgetPersistedDeletes(uid: string, entries: Array<{ store: string; key: string }>): void {
  if (entries.length === 0) return;
  const list = readPersistedDeletes();
  // То же: снимали бы маркеры, перезаписав нечитаемый журнал пустым списком.
  // Удаление просто уедет в облако ещё раз — это идемпотентно.
  if (list === null) return;
  const doomed = new Set(entries.map(e => upsertKey(e.store, e.key)));
  const next = list.filter(d => !(d.uid === uid && doomed.has(upsertKey(d.store, d.key))));
  if (next.length !== list.length) writePersistedDeletes(next);
}

/** Ключи `store:key`, облачное удаление которых ещё не дошло — восстановлению их не трогать. `null` — журнал не читается. */
export function getPendingStoreDeleteKeys(uid: string): Set<string> | null {
  const list = readPersistedDeletes();
  if (list === null) return null;
  return new Set(list.filter(d => d.uid === uid).map(d => `${d.store}:${d.key}`));
}

// SA-1: ожидающее обновление жило только в памяти. Окно потери — дебаунс
// (1,5 с) и полёт запроса: закрытая вкладка означает, что изменённая запись
// не уехала и больше никогда не уедет — фонового перескана нет,
// syncAllLocalStores зовётся только из ручной кнопки. Выбор — тот же образец,
// что у персистентных удалений выше: маркер лежит на диске до успеха.
//
// Почему не «фоновый syncAllLocalStores при входе и при возврате фокуса»: он
// перечитывает, перешифровывает и перезагружает ВСЕ записи всех 14 сторов
// ради нескольких потерянных, требует разблокированного сейфа и всё равно не
// накрывает окно дебаунса.
const PENDING_UPSERTS_LS_KEY = 'ai_sync_pending_upserts';

interface PersistedUpsert { uid: string; store: string; key: string; attempts?: number }

let reportedUpsertsUnreadable = false;

// ponytail: нечитаемый журнал загрузок читается как пустой — в отличие от
// удалений, загрузку можно вывести заново («Отправить всё» перечитывает сторы).
// Но битое содержимое молча не проходит (R3-012): сказать один раз за загрузку
// страницы. Недоступный storage уже называет журнал удалений — второй отчёт лишний.
function readPersistedUpserts(): PersistedUpsert[] {
  let raw: string | null;
  try { raw = localStorage.getItem(PENDING_UPSERTS_LS_KEY); } catch { return []; }
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) return parsed as PersistedUpsert[];
  } catch { /* ниже */ }
  if (!reportedUpsertsUnreadable) {
    reportedUpsertsUnreadable = true;
    reportError(new Error('Journal of pending AI-store uploads is unreadable — read as empty'), { action: 'readPersistedUpserts' }, 'warning');
  }
  return [];
}

function writePersistedUpserts(list: PersistedUpsert[]): void {
  // Не записалось — потеря ровно та же, что без персистентности.
  try { localStorage.setItem(PENDING_UPSERTS_LS_KEY, JSON.stringify(list)); } catch (e) { reportError(e, { action: 'writePersistedUpserts' }, 'warning'); }
}

const upsertKey = (store: string, key: string) => `${store}:${key}`;

// Составной id записи внутри JSON-нагрузки — не ключ localStorage, поэтому
// склейка через конкатенацию: гейт инвентаря ключей читает шаблоны с
// интерполяцией uid как объявление per-account ключа.
const recordId = (uid: string, itemKey: string) => uid + '/' + itemKey;

function persistUpserts(uid: string, entries: Array<{ store: string; key: string }>): void {
  if (entries.length === 0) return;
  const list = readPersistedUpserts();
  const seen = new Set(list.map(u => recordId(u.uid, upsertKey(u.store, u.key))));
  for (const { store, key } of entries) {
    const id = recordId(uid, upsertKey(store, key));
    if (seen.has(id)) continue;
    seen.add(id);
    list.push({ uid, store, key });
  }
  writePersistedUpserts(list);
}

/** Обновить счётчик попыток / убрать маркеры одним перечнём и одной записью. */
function applyUpsertMarkerChanges(
  uid: string,
  changes: { attempts: Map<string, number>; dropped: Set<string> },
  stillPending: (itemKey: string) => boolean,
): void {
  if (changes.attempts.size === 0 && changes.dropped.size === 0) return;
  const list = readPersistedUpserts();
  const next: PersistedUpsert[] = [];
  for (const u of list) {
    if (u.uid !== uid) { next.push(u); continue; }
    const id = upsertKey(u.store, u.key);
    if (changes.dropped.has(id) && !stillPending(id)) continue;
    const attempts = changes.attempts.get(id);
    next.push(attempts === undefined ? u : { ...u, attempts });
  }
  writePersistedUpserts(next);
}

/** Записи, ждущие облачного upsert и ещё не уехавшие (с пережитой перезагрузкой). */
export function getPendingStoreUpserts(uid: string): PersistedUpsert[] {
  return readPersistedUpserts().filter(u => u.uid === uid);
}

// SA-1: «молча сброшенного» не существует. Запись, которую сервер отверг
// MAX_UPSERT_ATTEMPTS раз, раньше исчезала из очереди без следа — ни в бейдже,
// ни в журнале. Теперь у неё есть персистентная отметка (по образцу
// OVERSIZED_LS_KEY), снимаемая успехом, новой правкой или удалением.
const DEAD_UPSERTS_LS_KEY = 'ai_sync_dead_upserts';

export interface DeadStoreUpsert {
  uid: string;
  store: string;
  key: string;
  lastError: string;
  attempts: number;
  timestamp: number;
}

let reportedDeadUpsertsUnreadable = false;

// R4-004: «пусто» и «не читается» — разные состояния. Битый JSON, прочитанный
// как [], позволял markDeadUpsert затереть журнал: прежние отметки гибли молча.
// null — «не читается»: писатели пропускают запись, читатели показывают нижнюю границу.
function readDeadUpserts(): DeadStoreUpsert[] | null {
  try {
    const raw = localStorage.getItem(DEAD_UPSERTS_LS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) return parsed as DeadStoreUpsert[];
  } catch { /* ниже */ }
  if (!reportedDeadUpsertsUnreadable) {
    reportedDeadUpsertsUnreadable = true;
    reportError(new Error('Journal of dead AI-store upserts is unreadable — new marks are not written'), { action: 'readDeadUpserts' }, 'warning');
  }
  return null;
}

function writeDeadUpserts(list: DeadStoreUpsert[]): void {
  try { localStorage.setItem(DEAD_UPSERTS_LS_KEY, JSON.stringify(list)); } catch (e) { reportError(e, { action: 'writeDeadUpserts' }, 'warning'); }
}

export function getDeadStoreUpserts(uid?: string): DeadStoreUpsert[] {
  const list = readDeadUpserts();
  return uid ? (list ?? []).filter(d => d.uid === uid) : (list ?? []);
}

/** false — журнал не читается и отметка не записана: маркер загрузки снимать нельзя (M-11). */
function markDeadUpsert(uid: string, store: string, key: string, attempts: number, lastError: string): boolean {
  const list = readDeadUpserts();
  if (list === null) return false;
  const next = list.filter(d => !(d.uid === uid && d.store === store && d.key === key));
  next.push({ uid, store, key, lastError, attempts, timestamp: Date.now() });
  writeDeadUpserts(next);
  return true;
}

/** Снять отметку «отвергнуто» сразу с нескольких записей — одним перечнём. */
function forgetDeadUpserts(uid: string, entries: Array<{ store: string; key: string }>): void {
  if (entries.length === 0) return;
  const list = readDeadUpserts();
  if (list === null) return;
  const doomed = new Set(entries.map(e => recordId(uid, upsertKey(e.store, e.key))));
  const next = list.filter(d => !doomed.has(recordId(d.uid, upsertKey(d.store, d.key))));
  if (next.length === list.length) return;
  writeDeadUpserts(next);
}

/** Состояние ИИ-сторов для бейджа: pending — ждущие upsert + незакрытые удаления. `unknown` — какой-то из журналов (удалений, отвергнутых, слишком больших) не читается, и счёт поэтому нижняя граница. oversized — записи, живущие только на устройстве (R4-017). */
export function getLocalStoreSyncSummary(uid: string): { pending: number; dead: number; oversized: number; unknown: boolean } {
  const deletes = readPersistedDeletes();
  const dead = readDeadUpserts();
  const oversized = readOversizedRecords(uid);
  const pending = getPendingStoreUpserts(uid).length
    + (deletes === null ? 0 : deletes.filter(d => d.uid === uid).length);
  return {
    pending,
    dead: (dead ?? []).filter(d => d.uid === uid).length,
    oversized: (oversized ?? []).length,
    unknown: deletes === null || dead === null || oversized === null,
  };
}

const OVERSIZED_LS_KEY = 'ai_sync_oversized_records';
const DEBOUNCE_DELAY_MS = 1500;

interface PendingSyncItem {
  store: SupportedLocalStoreName;
  key: string;
  isDelete?: boolean;
  /** R3-8: сколько раз обновление уже не доехало (только для upsert). */
  attempts?: number;
}

// R3-8: неудавшееся обновление повторяем в следующих проходах, но не вечно —
// запись, которую сервер отвергает всегда, не должна крутиться бесконечно.
const MAX_UPSERT_ATTEMPTS = 5;

interface OversizedRecordInfo {
  store: string;
  key: string;
  bytes: number;
  timestamp: number;
}

export function extractRecordTimestamp(val: unknown): number | null {
  if (!val || typeof val !== 'object') return null;
  const obj = val as Record<string, unknown>;
  if (typeof obj.updatedAt === 'number' && !isNaN(obj.updatedAt)) return obj.updatedAt;
  // AG-MERGE-1: числовой момент подкрепления точнее дневной строки. Без него
  // все подкрепления одной темы за день парсятся в одну полночь, и LWW
  // теряет подкрепление второго устройства — ровно тот случай, когда тема
  // реально активна.
  if (typeof obj.lastReinforcedAtMs === 'number' && !isNaN(obj.lastReinforcedAtMs)) {
    return obj.lastReinforcedAtMs;
  }
  if (typeof obj.lastReinforcedAt === 'string') {
    const ms = Date.parse(obj.lastReinforcedAt);
    if (!isNaN(ms)) return ms;
    // Бэкфилл ниже не нужен для сравнения, но строка могла быть невалидной.
  }
  if (typeof obj.generatedAt === 'number' && !isNaN(obj.generatedAt)) return obj.generatedAt;
  if (typeof obj.createdAt === 'number' && !isNaN(obj.createdAt)) return obj.createdAt;
  if (typeof obj.savedAt === 'number' && !isNaN(obj.savedAt)) return obj.savedAt;
  if (typeof obj.date === 'string') {
    const ms = Date.parse(obj.date);
    if (!isNaN(ms)) return ms;
  }
  if (typeof obj.eventDate === 'string') {
    const ms = Date.parse(obj.eventDate);
    if (!isNaN(ms)) return ms;
  }
  if (typeof obj.firstSeenAt === 'string') {
    const ms = Date.parse(obj.firstSeenAt);
    if (!isNaN(ms)) return ms;
  }
  return null;
}

let reportedOversizedUnreadable = false;

// R4-017: ключ отмеченных «слишком большая» записей — на учётку, а не общий:
// без скоупа чужие записи попадали в счётчик бейджа другой учётки.
function oversizedKeyFor(uid?: string): string {
  return uid ? `${OVERSIZED_LS_KEY}:${uid}` : OVERSIZED_LS_KEY;
}

function readOversizedRecords(uid?: string): OversizedRecordInfo[] | null {
  try {
    const raw = localStorage.getItem(oversizedKeyFor(uid));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as OversizedRecordInfo[];
  } catch { /* ниже */ }
  if (!reportedOversizedUnreadable) {
    reportedOversizedUnreadable = true;
    reportError(new Error('Journal of oversized AI-store records is unreadable — new marks are not written'), { action: 'readOversizedRecords' }, 'warning');
  }
  return null;
}

export function getOversizedRecords(uid?: string): OversizedRecordInfo[] {
  return readOversizedRecords(uid ?? getCurrentUser()?.uid) ?? [];
}

export function getOversizedRecordCount(uid?: string): number {
  return getOversizedRecords(uid).length;
}

/** false — отметка не записана: маркер загрузки снимать нельзя (M-11). */
function setOversizedRecord(store: string, key: string, bytes: number): boolean {
  const uid = getCurrentUser()?.uid;
  const list = readOversizedRecords(uid);
  if (list === null) return false;
  const next = list.filter(r => !(r.store === store && r.key === key));
  next.push({ store, key, bytes, timestamp: Date.now() });
  try {
    localStorage.setItem(oversizedKeyFor(uid), JSON.stringify(next));
    return true;
  } catch (e) {
    reportError(e, { action: 'setOversizedRecord' }, 'warning');
    return false;
  }
}

function removeOversizedRecord(store: string, key: string): void {
  const uid = getCurrentUser()?.uid;
  const list = readOversizedRecords(uid);
  if (list === null) return;
  const next = list.filter(r => !(r.store === store && r.key === key));
  if (next.length === list.length) return;
  try {
    localStorage.setItem(oversizedKeyFor(uid), JSON.stringify(next));
  } catch { /* намеренно: лишняя пометка «слишком большой» ничего не теряет */ }
}

/**
 * S-49: облачная копия диалога — строка `key` или страницы — расшифрованная и
 * разобранная. null — копии нет. `expected` — отметка для условной записи
 * (undefined — у строки нет числовой отметки). Строка есть, а прочитать её
 * нельзя — это не «облако пусто»: слепая запись поверх затёрла бы чужой ход.
 * Пусть запись упадёт и повторится.
 */
async function readDialogueText(payload: Record<string, unknown>): Promise<string> {
  const dec = await maybeDecrypt(payload, ['data'], []);
  if (typeof dec.data !== 'string') throw new Error('S-34: cloud dialogue row has no readable data');
  return dec.data;
}

async function readCloudDialogue(uid: string, key: string): Promise<{ dialogue: AIDialogue; expected: number | undefined } | null> {
  const [row, pages] = await Promise.all([
    DataProvider.getLocalStoreRecord(uid, 'aiDialogues', key),
    DataProvider.getLocalStoreRecordPages ? DataProvider.getLocalStoreRecordPages(uid, 'aiDialogues', key) : Promise.resolve([]),
  ]);
  const rows: CloudRow[] = [];
  if (row) rows.push({ key, payload: row.payload as Record<string, unknown> });
  for (const p of pages) rows.push({ key: p.key, payload: p.payload as Record<string, unknown> });
  const version = selectCloudVersion(rows);
  if (!version) return null;
  if (version.kind === 'refused') throw new Error(`S-49: cloud dialogue ${key} pages unreadable: ${version.reason}`);
  if (version.kind === 'single') {
    const text = await readDialogueText(version.row.payload);
    const at = version.row.payload.updatedAt;
    return { dialogue: JSON.parse(text) as AIDialogue, expected: typeof at === 'number' ? at : undefined };
  }
  let text = '';
  for (const page of version.pages) text += await readDialogueText(page.payload);
  return { dialogue: JSON.parse(text) as AIDialogue, expected: version.updatedAt };
}

export class LocalStoreSyncManager {
  private pending = new Map<string, PendingSyncItem>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private isSyncing = false;
  private hasRetriedOversized = false;
  // M-10: поколение удалений по ключу. Растёт только в scheduleStoreDelete —
  // flush, чистящий очередь, или подтянутое с диска удаление его не меняют.
  private deleteGen = new Map<string, number>();

  /**
   * SYNC-2: Retry records previously marked as oversized if their recorded size is now <= MAX_LOCAL_RECORD_BYTES.
   * Records that still exceed 2 MB are skipped to avoid unnecessary reads and re-serializations on every pass.
   */
  public retryOversizedRecords(): void {
    const oversized = getOversizedRecords();
    if (oversized.length === 0) return;
    for (const item of oversized) {
      if (
        item.bytes <= MAX_LOCAL_RECORD_BYTES &&
        SUPPORTED_LOCAL_STORES.includes(item.store as SupportedLocalStoreName)
      ) {
        this.scheduleStoreSync(item.store as SupportedLocalStoreName, item.key);
      }
    }
  }

  public scheduleStoreSync(store: SupportedLocalStoreName, key: string): void {
    const itemKey = `${store}:${key}`;
    const pendingItem = this.pending.get(itemKey);
    const hasPendingDelete = pendingItem?.isDelete === true;
    const uid = getCurrentUser()?.uid;
    // Журнал не читается — считаем, что удаление возможно: ветка ниже сама
    // решает по наличию записи в IndexedDB, а дренаж на неизвестном журнале
    // ни одного upsert не отправит.
    const deletes = uid ? readPersistedDeletes() : [];
    const hasPersistedDelete = !uid
      ? false
      : (deletes === null ? true : deletes.some(d => d.uid === uid && d.store === store && d.key === key));

    // A-3.2 (F-007): если у записи есть ожидающее или персистентное удаление,
    // а самой записи в IndexedDB уже нет (запоздалый ответ ИИ или фоновой задачи),
    // вызов игнорируется, чтобы не воскрешать удалённую строку в памяти и облаке.
    if (hasPendingDelete || hasPersistedDelete) {
      // R4-075: поколение — синхронно, до любых await. Между ним и resolve
      // чтения синхронный scheduleStoreDelete успевает поставить удаление —
      // перезаписывать его upsert'ом нельзя. Сравнивать саму запись очереди
      // нельзя: её меняет и flush, и тогда живой upsert терялся (M-10).
      const gen = this.deleteGen.get(itemKey) ?? 0;
      void (async () => {
        try {
          // База владельца маркера, а не «текущая»: между вызовом и чтением
          // учётка могла смениться (R3-009).
          const db = await getLocalDb(uid);
          const rec = await (db as unknown as { get(s: string, k: string): Promise<unknown> }).get(store, key);
          if (!rec) {
            return;
          }
          if ((this.deleteGen.get(itemKey) ?? 0) !== gen) {
            return;
          }
          this.pending.set(itemKey, { store, key, isDelete: false });
          if (uid) {
            persistUpserts(uid, [{ store, key }]);
            forgetDeadUpserts(uid, [{ store, key }]);
            // A-1 (R2-003): запись снова жива — обязательство «снести её в
            // облаке» снято здесь же, где поставлено обязательство «доехать как
            // обновление». Иначе следующий дренаж перечитает маркер с диска,
            // сожмёт pending как удаление и снесёт облачный ряд живой записи.
            forgetPersistedDelete(uid, store, key);
          }
          this.resetTimer();
        } catch (err) {
          reportError(err, { action: 'scheduleStoreSync_checkDeletedRecord', store, key });
        }
      })();
      return;
    }

    this.pending.set(itemKey, { store, key, isDelete: false });
    // SA-1: правка мёртвой записи даёт ей новый шанс — отметка «отвергнуто»
    // снимается, а счётчик попыток у ещё живого маркера остаётся: серия
    // быстрых правок не должна обнулять израсходованный бюджет повторов.
    if (uid) {
      persistUpserts(uid, [{ store, key }]);
      forgetDeadUpserts(uid, [{ store, key }]);
    }
    this.resetTimer();
  }

  public scheduleStoreDelete(store: SupportedLocalStoreName, key: string): void {
    const itemKey = `${store}:${key}`;
    const uid = getCurrentUser()?.uid;
    if (uid) {
      persistDelete(uid, store, key);
      // Обязательство «доехать как обновление» закрыто: теперь это удаление.
      applyUpsertMarkerChanges(uid, { attempts: new Map(), dropped: new Set([itemKey]) }, () => false);
      forgetDeadUpserts(uid, [{ store, key }]);
    }
    this.deleteGen.set(itemKey, (this.deleteGen.get(itemKey) ?? 0) + 1);
    this.pending.set(itemKey, { store, key, isDelete: true });
    this.resetTimer();
  }

  /**
   * S-34: облачная копия читается, союз пишется локально (get+merge+put в
   * одной транзакции) и уходит в облако с условием «updatedAt облака не
   * изменился». Ушёл — перечитываем и сливаем заново, до трёх раз; дальше
   * запись падает как обычная ошибка и повторяется штатным путём.
   *
   * S-49: копия крупнее одной страницы (> 500 КБ) тоже читается (строка `key`
   * или страницы) и пишется с условием: страницы `key#<updatedAt>#N` уходят
   * первыми, последним — манифест в строке `key` с тем же условием на прежний
   * `updatedAt`. Проиграли условие — свои страницы убираем и сливаем заново;
   * выиграли — убираем страницы всех прочих версий. Восстановление читает
   * только страницы, на которые указывает манифест.
   */
  private async uploadDialogue(
    uid: string,
    db: Awaited<ReturnType<typeof getLocalDb>>,
    key: string,
  ): Promise<'ok' | 'gone' | { oversized: number }> {
    for (let attempt = 0; ; attempt++) {
      const cloud = await readCloudDialogue(uid, key);
      // null — строки нет (insert); undefined — строка без числовой отметки,
      // условие поставить не на что, пишем как раньше.
      const expected: number | null | undefined = cloud ? cloud.expected : null;

      const tx = db.transaction('aiDialogues', 'readwrite');
      const current = await tx.store.get(key);
      if (!current) { await tx.done; return 'gone'; }
      const merged = cloud
        ? mergeDialogues(withMessageIds(current), cloud.dialogue)
        : { ...withMessageIds(current), schema: DIALOGUE_SCHEMA };
      if (dialogueFingerprint(merged) !== dialogueFingerprint(current) || merged.updatedAt !== current.updatedAt) {
        await tx.store.put(merged);
      }
      await tx.done;

      const jsonString = JSON.stringify(merged);
      const recordBytes = new TextEncoder().encode(jsonString).length;
      const chunks = recordBytes > PAGE_SPLIT_THRESHOLD_BYTES ? splitStringIntoChunks(jsonString, PAGE_SPLIT_THRESHOLD_BYTES) : [jsonString];
      if (recordBytes > MAX_LOCAL_RECORD_BYTES || chunks.length > PAGES_PER_REQUEST) return { oversized: recordBytes };

      let stored: boolean;
      if (chunks.length === 1) {
        const encrypted = await maybeEncrypt({ data: jsonString, updatedAt: merged.updatedAt }, ['data'], [], uid);
        if (expected === undefined) {
          await DataProvider.saveLocalStoreRecord(uid, 'aiDialogues', key, encrypted);
          stored = true;
        } else {
          stored = await DataProvider.saveLocalStoreRecordIfUnchanged(uid, 'aiDialogues', key, encrypted, expected);
        }
        if (stored) {
          if (DataProvider.deleteLocalStorePagedRecords) {
            await DataProvider.deleteLocalStorePagedRecords(uid, 'aiDialogues', key);
          }
          return 'ok';
        }
      } else {
        const totalPages = chunks.length;
        const pages: Array<{ key: string; payload: Awaited<ReturnType<typeof maybeEncrypt>> }> = [];
        for (let i = 0; i < totalPages; i++) {
          pages.push({
            key: `${key}#${merged.updatedAt}#${i}`,
            payload: await maybeEncrypt({ data: chunks[i], updatedAt: merged.updatedAt, page: i, totalPages }, ['data'], [], uid),
          });
        }
        await DataProvider.saveLocalStoreRecordPages(uid, 'aiDialogues', pages);
        const manifest = { manifest: true, updatedAt: merged.updatedAt, totalPages };
        if (expected === undefined) {
          await DataProvider.saveLocalStoreRecord(uid, 'aiDialogues', key, manifest);
          stored = true;
        } else {
          stored = await DataProvider.saveLocalStoreRecordIfUnchanged(uid, 'aiDialogues', key, manifest, expected);
        }
        if (stored) {
          if (DataProvider.deleteLocalStoreStalePages) {
            await DataProvider.deleteLocalStoreStalePages(uid, 'aiDialogues', key, merged.updatedAt);
          }
          return 'ok';
        }
        // Проигравшая попытка: её страницы никто не читает, убираем свои.
        if (DataProvider.deleteLocalStorePagedRecords) {
          await DataProvider.deleteLocalStorePagedRecords(uid, 'aiDialogues', `${key}#${merged.updatedAt}`);
        }
      }
      if (attempt >= 2) throw new Error(`S-34: cloud dialogue ${key} kept changing during upload`);
    }
  }

  private resetTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flushPending();
    }, DEBOUNCE_DELAY_MS);
  }

  public async flushPending(forceManual = false): Promise<{ synced: number; failed: number; skippedLocked: boolean; skippedOversized: number }> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (!this.hasRetriedOversized) {
      this.hasRetriedOversized = true;
      this.retryOversizedRecords();
    }

    const result = { synced: 0, failed: 0, skippedLocked: false, skippedOversized: 0 };
    const uid = getCurrentUser()?.uid;
    if (!uid) return result;

    // SEC-8: Background upload respects cloudSyncEnabled switch.
    // Manual / backfill actions (forceManual = true) are explicitly exempt.
    if (!forceManual && !cloudSyncEnabled(uid)) {
      return result;
    }

    // Check encryption status: if encryption enabled but session key locked, postpone!
    if (getEncryptionEnabled(uid) && !getSessionKey()) {
      result.skippedLocked = true;
      return result;
    }

    // Удаления, пережившие закрытие вкладки, возвращаются в очередь.
    const persistedDeletes = readPersistedDeletes();
    const deleteJournalUnknown = persistedDeletes === null;
    if (deleteJournalUnknown) {
      // Не знаем, какие из ожидающих отправки записей на самом деле удалены.
      // Один upsert воскрешает в облаке снесённый разбор, поэтому удаления
      // этот проход делает, а обновлений — нет (fail closed).
      const rawRes = readPersistedDeletesRaw();
      if (!('unavailable' in rawRes) && rawRes.raw !== null) {
        healCorruptDeleteJournal(rawRes.raw, uid);
      } else {
        reportDeleteJournalUnknown('flushPending_deleteJournalUnknown', uid);
      }
    } else {
      for (const d of persistedDeletes) {
        if (d.uid !== uid || !SUPPORTED_LOCAL_STORES.includes(d.store as SupportedLocalStoreName)) continue;
        const k = `${d.store}:${d.key}`;
        if (!this.pending.has(k)) this.pending.set(k, { store: d.store as SupportedLocalStoreName, key: d.key, isDelete: true });
      }
    }

    // SA-1: то же для обновлений — маркер переживает и закрытие вкладки, и
    // выключенную автосинхронизацию (раньше он жил только в памяти).
    for (const u of readPersistedUpserts()) {
      if (u.uid !== uid || !SUPPORTED_LOCAL_STORES.includes(u.store as SupportedLocalStoreName)) continue;
      const k = `${u.store}:${u.key}`;
      if (!this.pending.has(k)) this.pending.set(k, { store: u.store as SupportedLocalStoreName, key: u.key, isDelete: false, attempts: u.attempts ?? 0 });
    }

    if (this.pending.size === 0) return result;
    if (this.isSyncing) return result;

    // Изменения маркеров складываются и пишутся один раз в конце: проход по
    // ручному бэкфиллу касается тысяч записей, а перечитывать и перезаписывать
    // список ради каждой — O(n²).
    const markerChanges = {
      attempts: new Map<string, number>(),
      dropped: new Set<string>(),
      revived: [] as Array<{ store: string; key: string }>,
    };

    this.isSyncing = true;
    const items = Array.from(this.pending.values());
    this.pending.clear();
    try {
      let db: Awaited<ReturnType<typeof getLocalDb>>;
      try {
        db = await getLocalDb();
      } catch (e) {
        // Пачку не теряем: вернуть в очередь и попробовать в следующий проход.
        for (const it of items) this.pending.set(`${it.store}:${it.key}`, it);
        throw e;
      }

      for (const item of items) {
        const itemKey = `${item.store}:${item.key}`;
        if (deleteJournalUnknown && !item.isDelete) {
          // Отложить, а не исполнить: маркер на диске остаётся, обязательство
          // не считается закрытым, и бейдж по-прежнему показывает несданное.
          if (!this.pending.has(itemKey)) this.pending.set(itemKey, item);
          continue;
        }
        try {
          if (item.isDelete) {
            await DataProvider.deleteLocalStoreRecord(uid, item.store, item.key);
            forgetPersistedDelete(uid, item.store, item.key);
            removeOversizedRecord(item.store, item.key);
            markerChanges.dropped.add(itemKey);
            result.synced++;
            continue;
          }

          // Get record from IDB
          const rawRecord = await (db as unknown as { get(s: string, k: string): Promise<unknown> }).get(item.store, item.key);
          if (rawRecord === undefined) {
            // SA-1: локальной записи нет — отправлять нечего, маркер снимаем,
            // иначе бейдж навсегда останется «есть несданное».
            markerChanges.dropped.add(itemKey);
            markerChanges.revived.push({ store: item.store, key: item.key });
            continue;
          }

          // Belt-and-braces: refuse to upload records belonging to another user
          if (rawRecord && typeof rawRecord === 'object') {
            const owner = (rawRecord as { userId?: string; ownerId?: string; guestId?: string }).userId
              ?? (rawRecord as { userId?: string; ownerId?: string; guestId?: string }).ownerId
              ?? (rawRecord as { userId?: string; ownerId?: string; guestId?: string }).guestId;
            if (owner && owner !== uid) {
              markerChanges.dropped.add(itemKey);
              continue;
            }
          }

          // S-34: диалог сливается с облачной копией и пишется «если облако не
          // изменилось». Слепой upsert затирал ход другого устройства, пока
          // оно не успело забрать наш; после его очистки ход пропадал совсем.
          const markOversized = (recordBytes: number) => {
            // Для таких записей уже есть своя персистентная отметка — две на
            // одну запись удваивали бы счёт в бейдже. Не записалась — маркер
            // загрузки остаётся, иначе запись не учтена нигде (M-11).
            if (setOversizedRecord(item.store, item.key, recordBytes)) markerChanges.dropped.add(itemKey);
            result.skippedOversized++;
            logger.warn('LocalStoreSyncService', `Record too large to sync (${recordBytes} bytes): ${item.store}/${item.key}`);
            useActivityLogStore.getState().addActivity(
              'activity_ai_record_oversized',
              { action: 'localStoreSync_oversized', store: item.store, key: item.key, bytes: recordBytes, kb: Math.round(recordBytes / 1024) },
              'warning',
              'sync'
            );
          };

          if (item.store === 'aiDialogues') {
            const outcome = await this.uploadDialogue(uid, db, item.key);
            if (outcome === 'gone') {
              markerChanges.dropped.add(itemKey);
              markerChanges.revived.push({ store: item.store, key: item.key });
              continue;
            }
            if (outcome === 'ok') {
              removeOversizedRecord(item.store, item.key);
              result.synced++;
              markerChanges.dropped.add(itemKey);
              markerChanges.revived.push({ store: item.store, key: item.key });
              continue;
            }
            markOversized(outcome.oversized);
            continue;
          }

          const record: unknown = rawRecord;
          const jsonString = JSON.stringify(record);
          const recordBytes = new TextEncoder().encode(jsonString).length;

          // Страниц может выйти на одну больше, чем байт на 8 страниц: край
          // страницы не режет символ. Такая запись тоже не влезает в один запрос.
          const chunks = recordBytes > PAGE_SPLIT_THRESHOLD_BYTES ? splitStringIntoChunks(jsonString, PAGE_SPLIT_THRESHOLD_BYTES) : [jsonString];
          if (recordBytes > MAX_LOCAL_RECORD_BYTES || chunks.length > PAGES_PER_REQUEST) {
            markOversized(recordBytes);
            continue;
          }

          removeOversizedRecord(item.store, item.key);

          const recordTs = extractRecordTimestamp(record) ?? Date.now();

          if (recordBytes <= PAGE_SPLIT_THRESHOLD_BYTES) {
            // Single-row record upload
            const encrypted = await maybeEncrypt(
              {
                data: jsonString,
                updatedAt: recordTs,
              },
              ['data'],
              [],
              uid,
            );

            await DataProvider.saveLocalStoreRecord(
              uid,
              item.store,
              item.key,
              encrypted,
            );
            if (DataProvider.deleteLocalStorePagedRecords) {
              await DataProvider.deleteLocalStorePagedRecords(uid, item.store, item.key);
            }
          } else {
            // SYNC-4: Multi-page split upload
            const totalPages = chunks.length;

            // Сначала шифруем все страницы, потом пишем их одним запросом: запись
            // по одной давала другому устройству увидеть половину новой версии
            // рядом со старой, и восстановление отказывалось её собирать.
            const pages: Array<{ key: string; payload: Awaited<ReturnType<typeof maybeEncrypt>> }> = [];
            for (let i = 0; i < totalPages; i++) {
              pages.push({
                key: `${item.key}#${i}`,
                payload: await maybeEncrypt(
                  {
                    data: chunks[i],
                    updatedAt: recordTs,
                    page: i,
                    totalPages,
                  },
                  ['data'],
                  [],
                  uid,
                ),
              });
            }
            // Одна транзакция: страниц не больше PAGES_PER_REQUEST (проверено выше).
            await DataProvider.saveLocalStoreRecordPages(uid, item.store, pages);
            // Хвост прежней, более длинной версии: иначе в облаке смесь версий.
            if (DataProvider.deleteLocalStorePagedRecords) {
              await DataProvider.deleteLocalStorePagedRecords(uid, item.store, item.key, totalPages);
            }
            // Clean up stale unpaged record row if previously stored unpaged
            if (DataProvider.deleteLocalStoreExactRecord) {
              await DataProvider.deleteLocalStoreExactRecord(uid, item.store, item.key);
            }
          }
          result.synced++;
          // SA-1: облако приняло — обязательство закрыто.
          markerChanges.dropped.add(itemKey);
          markerChanges.revived.push({ store: item.store, key: item.key });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('ENCRYPT_REQUIRED') || msg.includes('LOCKED')) {
            result.skippedLocked = true;
            // Re-queue item to retry after vault unlock
            this.pending.set(itemKey, item);
          } else {
            result.failed++;
            reportError(err, { action: 'LocalStoreSyncService_item', store: item.store, key: item.key });
            // If this was a delete, it cannot be reconstructed from IDB because it
            // was already deleted locally before scheduleStoreDelete was called.
            // Re-queue it so network/server errors do not drop the delete permanently.
            if (item.isDelete) {
              this.pending.set(itemKey, item);
            } else if (!this.pending.has(itemKey)) {
              // R3-8: обновление читается из IDB заново, так что повтор отправит
              // свежую версию; новое изменение за время прохода не перетираем.
              const attempts = (item.attempts ?? 0) + 1;
              if (attempts < MAX_UPSERT_ATTEMPTS) {
                this.pending.set(itemKey, { ...item, attempts });
                markerChanges.attempts.set(itemKey, attempts);
              } else {
                // SA-1: раньше здесь запись исчезала молча.
                // Отметка не записалась — маркер загрузки остаётся (M-11).
                if (markDeadUpsert(uid, item.store, item.key, attempts, msg.slice(0, 200))) markerChanges.dropped.add(itemKey);
                useActivityLogStore.getState().addActivity(
                  'activity_local_store_dead_upsert',
                  { action: 'localStoreSync_dead', store: item.store, key: item.key, attempts, error: msg.slice(0, 200) },
                  'warning',
                  'sync'
                );
              }
            }
          }
        }
      }
    } finally {
      applyUpsertMarkerChanges(uid, markerChanges, k => this.pending.has(k));
      forgetDeadUpserts(uid, markerChanges.revived);
      this.isSyncing = false;
    }
    return result;
  }

  public async syncAllLocalStores(userId: string): Promise<{ synced: number; failed: number; skippedLocked: boolean; skippedOversized: number }> {
    const result = { synced: 0, failed: 0, skippedLocked: false, skippedOversized: 0 };
    if (!userId) return result;
    const currentUid = getCurrentUser()?.uid;
    if (!currentUid || currentUid !== userId) {
      return result;
    }

    if (getEncryptionEnabled(userId) && !getSessionKey()) {
      result.skippedLocked = true;
      return result;
    }

    const db = await getLocalDb(userId);

    // SA-1: бэкфилл касается всех записей всех сторов — маркеры пишутся одним
    // блоком, иначе по перезаписи списка на каждую запись.
    const batch: Array<{ store: SupportedLocalStoreName; key: string }> = [];

    for (const store of SUPPORTED_LOCAL_STORES) {
      if (!db.objectStoreNames.contains(store)) continue;
      try {
        const allKeys = await (db as unknown as { getAllKeys(s: string): Promise<IDBValidKey[]> }).getAllKeys(store);
        for (const key of allKeys) {
          batch.push({ store, key: String(key) });
        }
      } catch (err) {
        reportError(err, { action: 'LocalStoreSyncService_syncAll_store', store });
      }
    }

    for (const { store, key } of batch) {
      this.pending.set(`${store}:${key}`, { store, key, isDelete: false });
    }
    persistUpserts(userId, batch);
    forgetDeadUpserts(userId, batch);
    // Записи живы — обязательство «снести в облаке» по ним снимается, как в
    // плановом входе (A-1). Иначе следующий дренаж удалял облачный ряд живой
    // записи, только что выгруженной этим же проходом (R3 §4.1.1 a).
    forgetPersistedDeletes(userId, batch);

    // SEC-8 / SEC-6: syncAllLocalStores is a manual/backfill pass, so it runs
    // regardless of the background auto-sync toggle.
    return this.flushPending(true);
  }
}

export async function getLocalStoreRecordCounts(): Promise<number | null> {
  try {
    const db = await getLocalDb();
    let count = 0;
    for (const store of SUPPORTED_LOCAL_STORES) {
      if (!db.objectStoreNames.contains(store)) continue;
      count += await (db as unknown as { count(s: string): Promise<number> }).count(store);
    }
    return count;
  } catch (e) {
    // K-4/N-85: 0 интерфейс читает как «производных нет»; при отказе
    // IndexedDB честнее сказать, что посчитать не удалось.
    reportError(e, { action: 'getLocalStoreRecordCounts' }, 'warning');
    return null;
  }
}

export const LocalStoreSyncService = new LocalStoreSyncManager();
