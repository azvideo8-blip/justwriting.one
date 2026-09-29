import { getLocalDb } from '../storage/localDb';
import { DataProvider } from '../data';
import { getCurrentUser } from '../auth';
import { maybeEncrypt, getEncryptionEnabled } from '../crypto/cryptoHelpers';
import { getSessionKey } from '../crypto/encrypt';
import { cloudSyncEnabled } from '../sync/cloudSyncEnabled';
import { reportError } from '../../shared/errors/reportError';
import { logger } from '../../shared/errors/logger';
import { useActivityLogStore } from '../../shared/activity/useActivityLogStore';

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

/**
 * SYNC-4: Maximum total size across all pages for a single local store record.
 * Set to 10 MB (10 * 1024 * 1024 bytes) of plaintext.
 */
/** Страниц в одном запросе: 8 × 500 КБ после шифрования (~×1.4) ≈ 5.6 МБ < 10 МБ nginx. */
const PAGES_PER_REQUEST = 8;
export const MAX_LOCAL_RECORD_BYTES = 10 * 1024 * 1024;

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
  const list = readPersistedDeletes();
  // То же: снимали бы один маркер, перезаписав нечитаемый журнал пустым списком.
  // Удаление просто уедет в облако ещё раз — это идемпотентно.
  if (list === null) return;
  writePersistedDeletes(list.filter(d => !(d.uid === uid && d.store === store && d.key === key)));
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

function readDeadUpserts(): DeadStoreUpsert[] {
  try {
    const raw = localStorage.getItem(DEAD_UPSERTS_LS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as DeadStoreUpsert[]) : [];
  } catch {
    return [];
  }
}

function writeDeadUpserts(list: DeadStoreUpsert[]): void {
  try { localStorage.setItem(DEAD_UPSERTS_LS_KEY, JSON.stringify(list)); } catch (e) { reportError(e, { action: 'writeDeadUpserts' }, 'warning'); }
}

export function getDeadStoreUpserts(uid?: string): DeadStoreUpsert[] {
  return uid ? readDeadUpserts().filter(d => d.uid === uid) : readDeadUpserts();
}

function markDeadUpsert(uid: string, store: string, key: string, attempts: number, lastError: string): void {
  const list = readDeadUpserts().filter(d => !(d.uid === uid && d.store === store && d.key === key));
  list.push({ uid, store, key, lastError, attempts, timestamp: Date.now() });
  writeDeadUpserts(list);
}

/** Снять отметку «отвергнуто» сразу с нескольких записей — одним перечнём. */
function forgetDeadUpserts(uid: string, entries: Array<{ store: string; key: string }>): void {
  if (entries.length === 0) return;
  const list = readDeadUpserts();
  const doomed = new Set(entries.map(e => recordId(uid, upsertKey(e.store, e.key))));
  const next = list.filter(d => !doomed.has(recordId(d.uid, upsertKey(d.store, d.key))));
  if (next.length === list.length) return;
  writeDeadUpserts(next);
}

/** Состояние ИИ-сторов для бейджа: pending — ждущие upsert + незакрытые удаления. `unknown` — журнал удалений не читается, и pending поэтому нижняя граница. */
export function getLocalStoreSyncSummary(uid: string): { pending: number; dead: number; unknown: boolean } {
  const deletes = readPersistedDeletes();
  const pending = getPendingStoreUpserts(uid).length
    + (deletes === null ? 0 : deletes.filter(d => d.uid === uid).length);
  return { pending, dead: getDeadStoreUpserts(uid).length, unknown: deletes === null };
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

export function getOversizedRecords(): OversizedRecordInfo[] {
  try {
    const raw = localStorage.getItem(OVERSIZED_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getOversizedRecordCount(): number {
  return getOversizedRecords().length;
}

function setOversizedRecord(store: string, key: string, bytes: number): void {
  try {
    const current = getOversizedRecords().filter(r => !(r.store === store && r.key === key));
    current.push({ store, key, bytes, timestamp: Date.now() });
    localStorage.setItem(OVERSIZED_LS_KEY, JSON.stringify(current));
  } catch { /* ignore */ }
}

function removeOversizedRecord(store: string, key: string): void {
  try {
    const current = getOversizedRecords().filter(r => !(r.store === store && r.key === key));
    localStorage.setItem(OVERSIZED_LS_KEY, JSON.stringify(current));
  } catch { /* намеренно: лишняя пометка «слишком большой» ничего не теряет */ }
}

export class LocalStoreSyncManager {
  private pending = new Map<string, PendingSyncItem>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private isSyncing = false;
  private hasRetriedOversized = false;

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
      void (async () => {
        try {
          const db = await getLocalDb();
          const rec = await (db as unknown as { get(s: string, k: string): Promise<unknown> }).get(store, key);
          if (!rec) {
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
    this.pending.set(itemKey, { store, key, isDelete: true });
    this.resetTimer();
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

          const jsonString = JSON.stringify(rawRecord);
          const recordBytes = new TextEncoder().encode(jsonString).length;

          if (recordBytes > MAX_LOCAL_RECORD_BYTES) {
            setOversizedRecord(item.store, item.key, recordBytes);
            // Для таких записей уже есть своя персистентная отметка — две на
            // одну запись удваивали бы счёт в бейдже.
            markerChanges.dropped.add(itemKey);
            result.skippedOversized++;
            logger.warn('LocalStoreSyncService', `Record too large to sync (${recordBytes} bytes): ${item.store}/${item.key}`);
            useActivityLogStore.getState().addActivity(
              `Запись ${item.store}/${item.key} (${Math.round(recordBytes / 1024)} КБ) превышает лимит размера 10 МБ и остаётся только на устройстве`,
              { action: 'localStoreSync_oversized', store: item.store, key: item.key, bytes: recordBytes },
              'warning',
              'sync'
            );
            continue;
          }

          removeOversizedRecord(item.store, item.key);

          const recordTs = extractRecordTimestamp(rawRecord) ?? Date.now();

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
            const chunks = splitStringIntoChunks(jsonString, PAGE_SPLIT_THRESHOLD_BYTES);
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
            // ponytail: атомарно только до PAGES_PER_REQUEST страниц (~4 МБ записи):
            // тело запроса режет nginx (client_max_body_size 10m). Запись крупнее
            // уходит несколькими запросами; если такие появятся — версионные ключи.
            for (let i = 0; i < pages.length; i += PAGES_PER_REQUEST) {
              await DataProvider.saveLocalStoreRecordPages(uid, item.store, pages.slice(i, i + PAGES_PER_REQUEST));
            }
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
                markDeadUpsert(uid, item.store, item.key, attempts, msg.slice(0, 200));
                markerChanges.dropped.add(itemKey);
                useActivityLogStore.getState().addActivity(
                  `Запись ${item.store}/${item.key} не принята облаком ${attempts} раз и осталась только на устройстве`,
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

    // SEC-8 / SEC-6: syncAllLocalStores is a manual/backfill pass, so it runs
    // regardless of the background auto-sync toggle.
    return this.flushPending(true);
  }
}

export async function getLocalStoreRecordCounts(): Promise<number> {
  try {
    const db = await getLocalDb();
    let count = 0;
    for (const store of SUPPORTED_LOCAL_STORES) {
      if (!db.objectStoreNames.contains(store)) continue;
      count += await (db as unknown as { count(s: string): Promise<number> }).count(store);
    }
    return count;
  } catch {
    return 0;
  }
}

export const LocalStoreSyncService = new LocalStoreSyncManager();
