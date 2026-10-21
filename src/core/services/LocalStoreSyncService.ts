import { getLocalDb } from '../storage/localDb';
import { contentHash } from '../utils/contentHash';
import type { AIDialogue } from '../storage/localDb';
import { DIALOGUE_SCHEMA, dialogueFingerprint, mergeDialogues, withMessageIds } from '../storage/dialogueMerge';
import { DataProvider } from '../data';
import { getCurrentUser } from '../auth';
import { maybeEncrypt, maybeDecrypt, getEncryptionEnabled } from '../crypto/cryptoHelpers';
import { getSessionKey } from '../crypto/encrypt';
import { cloudSyncEnabled } from '../sync/cloudSyncEnabled';
import { pushSentHash, readSentHashes } from '../sync/sentHashes';
import {
  parseJournalRows,
  readJournal,
  readJournalRawForHealing,
  writeJournal,
  currentJournalUid,
} from '../sync/syncJournal';
import { reportError } from '../../shared/errors/reportError';
import { logger } from '../../shared/errors/logger';
import { useActivityLogStore } from '../../shared/activity/useActivityLogStore';
import { pageTextOf, parseLocalStoreKey, selectCloudVersion, PAGE_TEXT_FIELDS, type CloudRow } from './localStorePages';
import {
  HEAD_TEXT_FIELDS,
  SEGMENT_TEXT_FIELDS,
  headRowPayload,
  planDialogue,
  readSegmentVersion,
  segmentPrefixOf,
  segmentRowPayload,
  staleSegmentKeys,
  type CloudSegmentRow,
  type DialogueHead,
} from './dialogueSegments';

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

/**
 * T-4 (R-2): Защитный интервал удаления осиротевших окон (10 минут).
 * Окно моложе этого интервала относительно серверных часов не удаляется,
 * чтобы параллельный писатель успел связать его своим head'ом.
 */
export const ORPHAN_GRACE_PERIOD_MS = 10 * 60 * 1000;
/**
 * R7Q-007: grace — это отсрочка, а не отказ. Через сам grace повтор делать
 * нельзя (часы могут разойтись на границу), поэтому + 60 с запаса.
 */
export const ORPHAN_RETRY_DELAY_MS = ORPHAN_GRACE_PERIOD_MS + 60_000;
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
//
// S0-2 (F-3): ключ — на учётку. Прежний общий ключ делал одну битую строку
// чужой учётки стоп-сигналом для всех аккаунтов устройства.
const PENDING_DELETES_BASE = 'ai_sync_pending_deletes';
const CORRUPT_DELETES_BACKUP_PREFIX = 'ai_sync_pending_deletes.corrupt.';

export interface PersistedDelete { uid: string; store: string; key: string }

let hasReportedJournalUnknownThisPageLoad = false;

export function _resetReportedForTests(): void {
  hasReportedJournalUnknownThisPageLoad = false;
}

function isDeleteRow(v: unknown): v is PersistedDelete {
  return v !== null && typeof v === 'object'
    && typeof (v as Record<string, unknown>).uid === 'string'
    && typeof (v as Record<string, unknown>).store === 'string'
    && typeof (v as Record<string, unknown>).key === 'string';
}

/** Сырой текст своего журнала удалений — для починки битого JSON. */
export function readPersistedDeletesRaw(uid?: string | null): { raw: string | null } | { unavailable: true } {
  const res = readJournalRawForHealing(PENDING_DELETES_BASE, uid ?? currentJournalUid());
  if ('unavailable' in res) return { unavailable: true };
  if ('none' in res) return { raw: null };
  return { raw: res.raw };
}

export function parseDeleteJournal(raw: string): { list: PersistedDelete[]; dropped: number } | { corrupt: true } {
  const parsed = parseJournalRows(raw, isDeleteRow);
  return 'corrupt' in parsed ? parsed : { list: parsed.rows, dropped: parsed.dropped };
}

/**
 * Снести по префиксу прежние копии нечитаемого журнала и вернуть, сколько снесли.
 * Общий помощник двух починко — журнала удалений и журнала правок: без него тот же
 * цикл был написан дважды, и храповик S0-6 (обращения к localStorage в этом файле)
 * поднимался с 8 до 11 именно из-за копирования, а не из-за нового долга.
 */
function removeJournalBackups(prefix: string): number {
  const doomed: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) doomed.push(k);
  }
  for (const k of doomed) localStorage.removeItem(k);
  return doomed.length;
}

/**
 * Бэкап битого журнала и спасение валидных строк СВОЕЙ учётки. Строки других
 * аккаунтов из общего ключа не трогаются: их перенесёт их собственный проход
 * (флаг переноса — на учётку).
 */
export function healCorruptDeleteJournal(
  raw: string,
  uid?: string,
): { salvaged: PersistedDelete[]; dropped: number } {
  const target = uid ?? currentJournalUid();
  try {
    // R4-019: бэкап нигде не читается и затирался следующим heal молча. Остался
    // вариант «удалить с названным числом» — пусть потеря хотя бы видна в отчёте.
    const stale = removeJournalBackups(CORRUPT_DELETES_BACKUP_PREFIX);
    if (stale > 0) {
      reportError(new Error('Stale unreadable delete-journal backups wiped'), { action: 'healCorruptDeleteJournal_staleBackups', count: stale }, 'warning');
    }
    localStorage.setItem(`${CORRUPT_DELETES_BACKUP_PREFIX}${Date.now()}`, raw);
  } catch (err) {
    reportError(err, { action: 'healCorruptDeleteJournal_backup' }, 'warning');
  }

  const parsed = parseDeleteJournal(raw);
  const all = 'corrupt' in parsed ? [] : parsed.list.filter(d => d.uid === target);
  const dropped = 'corrupt' in parsed ? 0 : parsed.dropped;

  if (!writeJournal(PENDING_DELETES_BASE, target, all)) {
    reportError(new Error('Delete journal could not be written after heal'), { action: 'healCorruptDeleteJournal_writeSalvaged' }, 'warning');
  }

  reportDeleteJournalUnknown('flushPending_deleteJournalUnknown', target ?? undefined, {
    rawLength: raw.length,
    salvaged: all.length,
    dropped,
  });

  return { salvaged: all, dropped };
}

// A-5 (R2-012): «пусто» и «не прочитано» — разные состояния. Пустой журнал
// означает, что удалять в облаке нечего; нечитаемый (строка из другой версии
// приложения, отключённый storage, Safari в приватном режиме) — что мы этого не
// знаем. Сведение второго к первому через `catch { return [] }` позволяло
// дренажу upsert'ом вернуть в облако запись, которую пользователь уже снёс:
// `null` — «журнал не читается», `[]` — «прочитан и пуст».
// F-2: битый JSON в работающем storage исцеляется (бэкап + спасение валидных),
// а на проходе обнаружения возвращается null (fail closed для этого прохода).
export function readPersistedDeletes(uid?: string | null): PersistedDelete[] | null {
  const target = uid === undefined ? currentJournalUid() : uid;
  const res = readJournal(PENDING_DELETES_BASE, target, isDeleteRow);
  if ('unavailable' in res || 'corrupt' in res) return null;
  // Строка без ключа могла быть живым обязательством: угадывать нельзя (A-5).
  if (res.dropped > 0) return null;
  return res.rows;
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

function writePersistedDeletes(uid: string | null, list: PersistedDelete[]): void {
  // Не записалось — после перезагрузки удаление в облаке забудется, и разбор
  // останется там. Молчать об этом нельзя.
  if (!writeJournal(PENDING_DELETES_BASE, uid, list)) {
    reportError(new Error('Delete journal could not be written'), { action: 'writePersistedDeletes' }, 'warning');
  }
}

function persistDelete(uid: string, store: string, key: string): void {
  const list = readPersistedDeletes(uid);
  // Перечитать нечего — значит и дописать нельзя: запись одного нового
  // обязательства стёрла бы все прежние, а их нельзя вывести заново.
  if (list === null) return reportDeleteJournalUnknown('persistDelete_deleteJournalUnknown', uid);
  if (!list.some(d => d.uid === uid && d.store === store && d.key === key)) {
    list.push({ uid, store, key });
    writePersistedDeletes(uid, list);
  }
}

function forgetPersistedDelete(uid: string, store: string, key: string): void {
  forgetPersistedDeletes(uid, [{ store, key }]);
}

function forgetPersistedDeletes(uid: string, entries: Array<{ store: string; key: string }>): void {
  if (entries.length === 0) return;
  const list = readPersistedDeletes(uid);
  // То же: снимали бы маркеры, перезаписав нечитаемый журнал пустым списком.
  // Удаление просто уедет в облако ещё раз — это идемпотентно.
  if (list === null) return;
  const doomed = new Set(entries.map(e => upsertKey(e.store, e.key)));
  const next = list.filter(d => !(d.uid === uid && doomed.has(upsertKey(d.store, d.key))));
  if (next.length !== list.length) writePersistedDeletes(uid, next);
}

/** Ключи `store:key`, облачное удаление которых ещё не дошло — восстановлению их не трогать. `null` — журнал не читается. */
export function getPendingStoreDeleteKeys(uid: string): Set<string> | null {
  const list = readPersistedDeletes(uid);
  if (list === null) return null;
  return new Set(list.filter(d => d.uid === uid).map(d => `${d.store}:${d.key}`));
}

/** Журнал учётки по базовому имени ключа — диагностика и тест переноса (S0-2). */
export function readScopedJournal(base: string, uid: string | null): PersistedDelete[] | null {
  const res = readJournal(base, uid, isDeleteRow);
  if ('unavailable' in res || 'corrupt' in res || res.dropped > 0) return null;
  return res.rows;
}

// SA-1: ожидающее обновление жило только в памяти. Окно потери — дебаунс
// (1,5 с) и полёт запроса: закрытая вкладка означает, что изменённая запись
// не уехала и больше никогда не уедет — фонового перескана нет,
// syncAllLocalStores зовётся только из ручной кнопки. Выбор — тот же образец,
// что у персистентных удалений выше: маркер лежит на диске до успеха.
//
// S0-2 (F-3, остаток R3-012): ключ — на учётку, а нечитаемый журнал больше не
// читается как пустой. «Не знаю, что должно быть выгружено» — это `null`, и на
// нём дренаж останавливает правки, как уже делает с удалениями.
const PENDING_UPSERTS_BASE = 'ai_sync_pending_upserts';

interface PersistedUpsert { uid: string; store: string; key: string; attempts?: number }

let reportedUpsertsUnreadable = false;

function isUpsertRow(v: unknown): v is PersistedUpsert {
  const o = v as Record<string, unknown> | null;
  return o !== null && typeof o === 'object'
    && typeof o.uid === 'string' && typeof o.store === 'string' && typeof o.key === 'string'
    && (o.attempts === undefined || typeof o.attempts === 'number');
}

function readPersistedUpserts(uid: string | null): PersistedUpsert[] | null {
  const res = readJournal(PENDING_UPSERTS_BASE, uid, isUpsertRow);
  if ('rows' in res && res.dropped === 0) return res.rows;
  if (!reportedUpsertsUnreadable) {
    reportedUpsertsUnreadable = true;
    reportError(
      new Error('Journal of pending AI-store uploads is unreadable — uploads are held back, not assumed empty'),
      { action: 'readPersistedUpserts', dropped: 'rows' in res ? res.dropped : undefined },
      'warning',
    );
  }
  return null;
}

/** Сырой текст своего журнала правок — для починки битого JSON (как у удалений). */
function readPersistedUpsertsRaw(uid: string | null): { raw: string | null } | { unavailable: true } {
  const res = readJournalRawForHealing(PENDING_UPSERTS_BASE, uid);
  if ('unavailable' in res) return { unavailable: true };
  if ('none' in res) return { raw: null };
  return { raw: res.raw };
}

/** Бэкап битого журнала и спасение валидных строк своей учётки. */
function healCorruptUpsertJournal(raw: string, uid: string | null): PersistedUpsert[] {
  try {
    // SF2-7: прежние копии нечитаемого журнала правок сносятся перед новой —
    // ровно как у журнала удалений (`healCorruptDeleteJournal`, общий помощник
    // `removeJournalBackups`). Без этого на устройстве копился рой `…corrupt.<ts>`
    // на каждый битый прогон: их никто не читает, а место в localStorage (5 МБ на
    // весь браузер) они занимают.
    const stale = removeJournalBackups(CORRUPT_UPSERTS_BACKUP_PREFIX);
    if (stale > 0) {
      reportError(new Error('Stale unreadable upsert-journal backups wiped'),
        { action: 'healCorruptUpsertJournal_staleBackups', count: stale }, 'warning');
    }
    localStorage.setItem(`${CORRUPT_UPSERTS_BACKUP_PREFIX}${Date.now()}`, raw);
  } catch (err) {
    reportError(err, { action: 'healCorruptUpsertJournal_backup' }, 'warning');
  }
  const parsed = parseJournalRows(raw, isUpsertRow);
  const salvaged = 'corrupt' in parsed ? [] : parsed.rows.filter(u => u.uid === uid);
  if (!writeJournal(PENDING_UPSERTS_BASE, uid, salvaged)) {
    reportError(new Error('Upload journal could not be written after heal'), { action: 'healCorruptUpsertJournal_writeSalvaged' }, 'warning');
  }
  return salvaged;
}

function writePersistedUpserts(uid: string | null, list: PersistedUpsert[]): boolean {
  const ok = writeJournal(PENDING_UPSERTS_BASE, uid, list);
  if (!ok) reportError(new Error('Upload journal could not be written'), { action: 'writePersistedUpserts' }, 'warning');
  return ok;
}

const upsertKey = (store: string, key: string) => `${store}:${key}`;

// SF-8: журнал правок не читается — дописать отметку нельзя (перезапись стёрла бы
// прежние обязательства), но и молча её выбросить нельзя. Без отметки S0-3 читает
// запись как «невыгруженной правки нет» и отдаёт её облаку, а `persistUpserts`
// именно так и делал: `return` без следа. Вкладка, закрытая до починки битого JSON,
// = правка перезаписана. Теперь отметка живёт в памяти аккаунта, об этом пишет в
// журнал ошибок, и переезжает в журнал, как только тот снова читается.
//
// Память не переживает закрытие вкладки — это потолок того, что можно сделать без
// диска; окно, которое она закрывает, — «журнал битый → следующий дренаж его лечит».
const memoryPendingUpserts = new Map<string, Set<string>>();
let reportedMemoryPendingUpserts = false;

function holdPendingUpsertsInMemory(uid: string, entries: Array<{ store: string; key: string }>): void {
  if (entries.length === 0) return;
  const held = memoryPendingUpserts.get(uid) ?? new Set<string>();
  for (const { store, key } of entries) held.add(upsertKey(store, key));
  memoryPendingUpserts.set(uid, held);
  if (!reportedMemoryPendingUpserts) {
    reportedMemoryPendingUpserts = true;
    reportError(
      new Error('Upload journal is unreadable — pending marks are held in memory and re-committed when it reads again'),
      { action: 'persistUpserts_memoryFallback', uid, held: held.size },
      'warning',
    );
  }
}

function memoryPendingUpsertEntries(uid: string): Array<{ store: string; key: string }> {
  const held = memoryPendingUpserts.get(uid);
  if (!held || held.size === 0) return [];
  return [...held].map(k => {
    const i = k.indexOf(':');
    return { store: k.slice(0, i), key: k.slice(i + 1) };
  });
}

/** Дописать память-отметки в журнал, если он снова читается. Успех — память чиста. */
function commitMemoryPendingUpserts(uid: string): boolean {
  const held = memoryPendingUpsertEntries(uid);
  if (held.length === 0) return true;
  const list = readPersistedUpserts(uid);
  if (list === null) {
    holdPendingUpsertsInMemory(uid, held);
    return false;
  }
  const seen = new Set(list.map(u => recordId(u.uid, upsertKey(u.store, u.key))));
  for (const { store, key } of held) {
    const id = recordId(uid, upsertKey(store, key));
    if (seen.has(id)) continue;
    seen.add(id);
    list.push({ uid, store, key });
  }
  if (!writePersistedUpserts(uid, list)) {
    holdPendingUpsertsInMemory(uid, held);
    return false;
  }
  memoryPendingUpserts.delete(uid);
  return true;
}

// Составной id записи внутри JSON-нагрузки — не ключ localStorage, поэтому
// склейка через конкатенацию: гейт инвентаря ключей читает шаблоны с
// интерполяцией uid как объявление per-account ключа.
const recordId = (uid: string, itemKey: string) => uid + '/' + itemKey;

function persistUpserts(uid: string, entries: Array<{ store: string; key: string }>): void {
  if (entries.length === 0) return;
  const list = readPersistedUpserts(uid);
  // Журнал не читается — дописывать нельзя: перезапись стёрла бы прежние
  // обязательства (тот же класс, что у удалений, A-5). SF-8: отметку держим в
  // памяти аккаунта, чтобы следующий читаемый проход её дописал.
  if (list === null) {
    holdPendingUpsertsInMemory(uid, entries);
    return;
  }
  // Что висело в памяти — едет в журнал этим же списком.
  const carried = memoryPendingUpsertEntries(uid);
  const seen = new Set(list.map(u => recordId(u.uid, upsertKey(u.store, u.key))));
  for (const { store, key } of [...entries, ...carried]) {
    const id = recordId(uid, upsertKey(store, key));
    if (seen.has(id)) continue;
    seen.add(id);
    list.push({ uid, store, key });
  }
  if (writePersistedUpserts(uid, list)) memoryPendingUpserts.delete(uid);
  else holdPendingUpsertsInMemory(uid, entries);
}

/** Обновить счётчик попыток / убрать маркеры одним перечнём и одной записью. */
function applyUpsertMarkerChanges(
  uid: string,
  changes: { attempts: Map<string, number>; dropped: Set<string> },
  stillPending: (itemKey: string) => boolean,
): void {
  if (changes.attempts.size === 0 && changes.dropped.size === 0) return;
  const list = readPersistedUpserts(uid);
  if (list === null) return;
  const next: PersistedUpsert[] = [];
  for (const u of list) {
    if (u.uid !== uid) { next.push(u); continue; }
    const id = upsertKey(u.store, u.key);
    if (changes.dropped.has(id) && !stillPending(id)) continue;
    const attempts = changes.attempts.get(id);
    next.push(attempts === undefined ? u : { ...u, attempts });
  }
  // Не записалось — на диске остаётся ПРЕЖНИЙ список: снятые отметки не сняты,
  // счётчик попыток не записан. Обязательство не потеряно (запись стоит под тем же
  // флагом «не знаю»), а потеряна была бы, пиши мы сюда пустой список вместо отказа.
  writePersistedUpserts(uid, next); // намеренно: см. комментарий выше
}

/**
 * T-8 (0.10.0): ключи `store:key`, у которых есть невыгруженная локальная правка
 * этого аккаунта — для спора копий при заборе. `null` — какой-то из журналов не
 * читается: «нет правок» и «не знаю» — разные ответы, и на `null` забор обязан
 * оставить локальную копию.
 *
 * SF-1/SF-3: журнал правок — не полный список такого долга. Отказ выгрузки
 * снимает отметку в трёх штатных местах: после `MAX_UPSERT_ATTEMPTS` запись
 * переходит в `ai_sync_dead_upserts` (`markerChanges.dropped`), непоместившаяся —
 * в `oversized` (`markOversized`). Обязательство при этом не закрыто: правка
 * осталась единственной копией. Без союза журналов забор читал снятую отметку как
 * «правок нет» и по правилу S0-3 (`нет базы + содержимое отличается → облако`)
 * затирал её облачной копией — то есть CAS-отказ, придуманный ничего не терять,
 * терял правку на следующем заборе.
 *
 * Отметку в журнале правок при этом НЕ оставляем: дренаж перечитывает журнал на
 * каждом проходе, и записи, отвергнутые сервером, крутились бы вечно, удваивая
 * счёт в бейдже (тот же довод, что у `markOversized`). Держим обязательство в
 * его собственном журнале, а здесь собираем из всех трёх.
 */
export function getPendingUpsertKeySet(uid: string): Set<string> | null {
  const list = readPersistedUpserts(uid);
  if (list === null) return null;
  const keys = new Set(list.filter(u => u.uid === uid).map(u => upsertKey(u.store, u.key)));

  const dead = readDeadUpserts(uid);
  if (dead === null) return null;
  for (const d of dead) {
    if (d.uid === uid) keys.add(upsertKey(d.store, d.key));
  }

  const oversized = readOversizedRecords(uid);
  if (oversized === null) return null;
  for (const o of oversized) keys.add(`${o.store}:${o.key}`);

  // SF-8: отметки, которые не удалось записать в журнал правок. Пока журнал не
  // читается, весь этот множество и так `null` («не знаю»), а вот после починки,
  // до переноса в журнал, они обязаны быть здесь — иначе окно между «починили» и
  // «дописали» читается как «правок нет».
  for (const k of memoryPendingUpserts.get(uid) ?? []) keys.add(k);

  return keys;
}

/** T-8: серверная отметка облачной версии, от которой получена локальная копия. */
export const CLOUD_STAMP_FIELD = '_cloudStampedAt';
/**
 * SF2-2: два хэша рядом с отметкой. `CLOUD_BASE_HASH_FIELD` — содержимое того
 * облачного ряда, к которому относится отметка базы; `CLOUD_SENT_HASHES_FIELD` —
 * содержимое ОТПРАВЛЕННЫХ нагрузок, ответа на которые мы не видели. Оба поля
 * прибора, в облако не едут (stripCloudStamp) и переживают перезапись строки
 * писателем (обёртка `put` в localDb).
 *
 * Без них отказ CAS различается только «облако = наша ТЕКУЩАЯ копия», а этого
 * мало: на плохой сети облако держит нашу же ПРОШЛУЮ отправку (ответ потерялся),
 * а после слепого upsert другого устройства («зашифровать всё») облако держит
 * тот же текст, от которого мы правили. В обоих случаях чужой правки нет, и
 * прежний код объявлял её: пять отказов — запись мёртва, синхронизация её встаёт
 * с обеих сторон.
 *
 * SF3-3: списком, а не одним слотом. Слот перезаписывается ПЕРЕД каждым запросом
 * (`rememberSentHash`), а читается обратно только при отказе — значит попытка,
 * которая до сервера не дошла (`network_pre`), стирает доказательство предыдущей,
 * дошедшей без ответа. Дальше наша же версия в облаке читается чужой правкой, и
 * запись умирает ровно так, как умирала без хэша вообще.
 */
export const CLOUD_BASE_HASH_FIELD = '_cloudBaseHash';
export const CLOUD_SENT_HASHES_FIELD = '_cloudSentHashes';

export function stripCloudStamp(record: unknown): unknown {
  if (!record || typeof record !== 'object') return record;
  const source = record as Record<string, unknown>;
  if (!(CLOUD_STAMP_FIELD in source) && !(CLOUD_BASE_HASH_FIELD in source) && !(CLOUD_SENT_HASHES_FIELD in source)) {
    return record;
  }
  const copy = { ...source };
  delete copy[CLOUD_STAMP_FIELD];
  delete copy[CLOUD_BASE_HASH_FIELD];
  delete copy[CLOUD_SENT_HASHES_FIELD];
  return copy;
}

/** Обновления, ждущие облачного upsert и ещё не уехавшие. `null` — журнал не читается. */
export function getPendingStoreUpserts(uid: string): PersistedUpsert[] | null {
  return readPersistedUpserts(uid);
}

// SA-1: «молча сброшенного» не существует. Запись, которую сервер отверг
// MAX_UPSERT_ATTEMPTS раз, раньше исчезала из очереди без следа — ни в бейдже,
// ни в журнале. Теперь у неё есть персистентная отметка (по образцу
// OVERSIZED_LS_KEY), снимаемая успехом, новой правкой или удалением.
const DEAD_UPSERTS_BASE = 'ai_sync_dead_upserts';
const CORRUPT_UPSERTS_BACKUP_PREFIX = 'ai_sync_pending_upserts.corrupt.';

export interface DeadStoreUpsert {
  uid: string;
  store: string;
  key: string;
  lastError: string;
  attempts: number;
  timestamp: number;
}

let reportedDeadUpsertsUnreadable = false;

function isDeadRow(v: unknown): v is DeadStoreUpsert {
  const o = v as Record<string, unknown> | null;
  return o !== null && typeof o === 'object'
    && typeof o.uid === 'string' && typeof o.store === 'string' && typeof o.key === 'string'
    && typeof o.lastError === 'string' && typeof o.attempts === 'number' && typeof o.timestamp === 'number';
}

// R4-004: «пусто» и «не читается» — разные состояния. Битый JSON, прочитанный
// как [], позволял markDeadUpsert затереть журнал: прежние отметки гибли молча.
// null — «не читается»: писатели пропускают запись, читатели показывают нижнюю границу.
function readDeadUpserts(uid: string | null): DeadStoreUpsert[] | null {
  const res = readJournal(DEAD_UPSERTS_BASE, uid, isDeadRow);
  if ('rows' in res && res.dropped === 0) return res.rows;
  if (!reportedDeadUpsertsUnreadable) {
    reportedDeadUpsertsUnreadable = true;
    reportError(new Error('Journal of dead AI-store upserts is unreadable — new marks are not written'), { action: 'readDeadUpserts' }, 'warning');
  }
  return null;
}

function writeDeadUpserts(uid: string | null, list: DeadStoreUpsert[]): void {
  if (!writeJournal(DEAD_UPSERTS_BASE, uid, list)) {
    reportError(new Error('Dead-upsert journal could not be written'), { action: 'writeDeadUpserts' }, 'warning');
  }
}

export function getDeadStoreUpserts(uid?: string): DeadStoreUpsert[] {
  const target = uid ?? currentJournalUid();
  const list = readDeadUpserts(target);
  return uid ? (list ?? []).filter(d => d.uid === uid) : (list ?? []);
}

/** false — журнал не читается и отметка не записана: маркер загрузки снимать нельзя (M-11). */
function markDeadUpsert(uid: string, store: string, key: string, attempts: number, lastError: string): boolean {
  const list = readDeadUpserts(uid);
  if (list === null) return false;
  const next = list.filter(d => !(d.uid === uid && d.store === store && d.key === key));
  next.push({ uid, store, key, lastError, attempts, timestamp: Date.now() });
  writeDeadUpserts(uid, next);
  return true;
}

/** Снять отметку «отвергнуто» сразу с нескольких записей — одним перечнём. */
function forgetDeadUpserts(uid: string, entries: Array<{ store: string; key: string }>): void {
  if (entries.length === 0) return;
  const list = readDeadUpserts(uid);
  if (list === null) return;
  const doomed = new Set(entries.map(e => recordId(uid, upsertKey(e.store, e.key))));
  const next = list.filter(d => !doomed.has(recordId(d.uid, upsertKey(d.store, d.key))));
  if (next.length === list.length) return;
  writeDeadUpserts(uid, next);
}

/** Состояние ИИ-сторов для бейджа: pending — ждущие upsert + незакрытые удаления. `unknown` — какой-то из журналов (правок, удалений, отвергнутых, слишком больших) не читается, и счёт поэтому нижняя граница. oversized — записи, живущие только на устройстве (R4-017). */
export function getLocalStoreSyncSummary(uid: string): { pending: number; dead: number; oversized: number; unknown: boolean } {
  const deletes = readPersistedDeletes(uid);
  const upserts = readPersistedUpserts(uid);
  const dead = readDeadUpserts(uid);
  const oversized = readOversizedRecords(uid);
  const pending = (upserts === null ? 0 : upserts.filter(u => u.uid === uid).length)
    + (deletes === null ? 0 : deletes.filter(d => d.uid === uid).length);
  return {
    pending,
    dead: (dead ?? []).filter(d => d.uid === uid).length,
    oversized: (oversized ?? []).length,
    unknown: deletes === null || upserts === null || dead === null || oversized === null,
  };
}

const OVERSIZED_LS_KEY = 'ai_sync_oversized_records';
const DEBOUNCE_DELAY_MS = 1500;
// R7Q-006: запертый сейф повторяем не через дебаунс в 1,5 с, а через 30 с —
// иначе это постоянный опрос на весь вечер.

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
// D1-7 (П-4): журнал пишется по uid прохода, а не по getCurrentUser(): при смене
// аккаунта посреди дренажа читатель этого прохода (getPendingUpsertKeySet) не
// увидел бы пометку «слишком большое», и забор решил бы спор в пользу облака.
function setOversizedRecord(uid: string, store: string, key: string, bytes: number): boolean {
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

function removeOversizedRecord(uid: string, store: string, key: string): void {
  const list = readOversizedRecords(uid);
  if (list === null) return;
  const next = list.filter(r => !(r.store === store && r.key === key));
  if (next.length === list.length) return;
  try {
    localStorage.setItem(oversizedKeyFor(uid), JSON.stringify(next));
  } catch { /* намеренно: лишняя пометка «слишком большой» ничего не теряет */ }
}

/**
 * S-49/S-54: облачная копия диалога — строка `key` или страницы — расшифрованная
 * и разобранная. null — копии нет. `expected` — отметка для условной записи
 * (undefined — у строки нет числовой отметки).
 *
 * M-5: копия может лежать head’ом и сегментами; тогда вместе с диалогом
 * отдаются head и строки окон — план записи сверяется с ними дословно.
 *
 * S-54: открытая строка под включённым сейфом читается: так выглядит обрыв
 * «зашифровать всё» на середине, и слияние запишет её обратно уже
 * зашифрованной. Строка, которую не прочитать иначе (чужой ключ, порча),
 * остаётся ошибкой, а не «облако пусто», и один раз попадает в журнал.
 */
const unreadableReported = new Set<string>();

interface CloudDialogue {
  /** null — указателя версии нет вовсе (оборванная попытка: строки окон легли,
   *  head не подписан). Сами окна при этом возвращаются в `segments`: план
   *  принимает их, а не пишет второй экземпляр тех же байтов, и убирает те, что
   *  не пригодятся. */
  dialogue: AIDialogue | null;
  expected: number | null | undefined;
  /** Только у сегментной копии: head, который её описывает. */
  head?: DialogueHead;
  /** Расшифрованные строки сегментов этого диалога; пусто, если их нет. */
  segments?: CloudSegmentRow[];
  /** Head называет эти окна, а строк нет: копия неполная, выгрузка чинит её и
   *  переподписывает head. Читателю такая копия не отдаётся ни при каких условиях. */
  incomplete?: string[];
}

function isPlaintextUnderVault(e: unknown): boolean {
  // По форме, не по instanceof: DecryptionError из cryptoHelpers, причина — PLAINTEXT_UNDER_VAULT.
  const err = e as { name?: unknown; cause?: { message?: unknown } } | null;
  return err?.name === 'DecryptionError' && err.cause?.message === 'PLAINTEXT_UNDER_VAULT';
}

async function readDialogueText(payload: Record<string, unknown>, what = 'cloud dialogue row'): Promise<string> {
  try {
    const dec = await maybeDecrypt(payload, [...PAGE_TEXT_FIELDS], []);
    const text = pageTextOf(dec);
    if (text === null) throw new Error(`S-34: ${what} has no readable data`);
    return text;
  } catch (e) {
    if (!isPlaintextUnderVault(e)) throw e;
    // S-54 + M-3: открытый текст под сейфом — обрыв «зашифровать всё»; читаем то
    // поле, в котором он лежит (новый формат — chunk, прежние страницы — data).
    const raw = pageTextOf(payload);
    if (raw !== null) return raw;
    throw e;
  }
}

/**
 * S0-1: открытая строка скалярного стора из облака — её JSON и серверная
 * отметка. `null` — строки нет. Непрочитываемая строка — ошибка, а не «облака
 * нет»: тот же класс, что S-54 для диалогов (условная запись поверх того, чего
 * не можем прочесть, стёрла бы чужую правку).
 */
/**
 * SF2-7: старше ли базовый ряд собственной полной группе страниц. Строка
 * `key#N` — страница той же записи; если её набор полон и свежет базовой строки,
 * базовая строка — остаток неудавшейся выгрузки, а не актуальная версия.
 */
async function baseRowIsLeftover(
  uid: string,
  store: SupportedLocalStoreName,
  key: string,
  baseStamp: number | null,
): Promise<boolean> {
  if (!DataProvider.getLocalStoreRecordPages) return false;
  const pages = await DataProvider.getLocalStoreRecordPages(uid, store, key);
  if (pages.length === 0) return false;
  const groupMax = pages.reduce((m, r) => Math.max(m, r.stamped_at ?? 0), 0);
  if (baseStamp !== null && groupMax <= baseStamp) return false;
  const rows: CloudRow[] = pages.map(r => ({
    key: r.key, payload: r.payload as Record<string, unknown>, checksum: r.checksum, stamped_at: r.stamped_at,
  }));
  const version = selectCloudVersion(rows, false);
  return version !== null && version.kind === 'pages';
}

async function readCloudScalar(
  uid: string,
  store: SupportedLocalStoreName,
  key: string,
): Promise<{ json: string; stampedAt: number | null } | null> {
  const row = await DataProvider.getLocalStoreRecord(uid, store, key);
  if (!row) return null;
  return {
    json: await readDialogueText(row.payload as Record<string, unknown>, 'cloud scalar row'),
    stampedAt: typeof row.stamped_at === 'number' ? row.stamped_at : null,
  };
}

/** То же для полей head'а и сегмента: открытый текст под сейфом читается, всё
 *  остальное — ошибка. Пустого «не прочитали, значит строки нет» здесь нет. */
async function decryptFields(payload: Record<string, unknown>, fields: readonly string[]): Promise<Record<string, unknown>> {
  try {
    return await maybeDecrypt(payload, [...fields], []);
  } catch (e) {
    if (!isPlaintextUnderVault(e)) throw e;
    return payload;
  }
}

/**
 * Копия диалога из облака. M-5: диалог может лежать сегментами (head в строке
 * `key` + строки `key@seg…`) или в прежних форматах — одной строкой с `data`
 * либо страницами `key#…`; читаем и то, и другое, потому что в облаке живут
 * копии обоих видов (старые таб-коды, записи до миграции).
 *
 * Неполная или нечитаемая копия — ошибка, а не «облака нет»: слепая запись
 * поверх укороченной копии затёрла бы чужие ходы.
 */
async function readCloudDialogue(uid: string, key: string): Promise<CloudDialogue | null> {
  const [row, pages, segRows] = await Promise.all([
    DataProvider.getLocalStoreRecord(uid, 'aiDialogues', key),
    DataProvider.getLocalStoreRecordPages ? DataProvider.getLocalStoreRecordPages(uid, 'aiDialogues', key) : Promise.resolve([]),
    DataProvider.getLocalStoreRecordsByKeyPrefix(uid, 'aiDialogues', segmentPrefixOf(key)),
  ]);
  const rowPayload = row ? row.payload as Record<string, unknown> : null;
  const isSegmented = rowPayload?.head === true;

  try {
    // Строки сегментов расшифровываем всегда: их мог назвать head другой стороны,
    // а без head это осиротевшие остатки оборванной попытки — и то, и другое
    // план переиспользует вместо записи второго экземпляра тех же байтов.
    // Непрочитаемая строка, которой head НЕ называет, чтения не ломает (она не
    // часть диалога), но её ключ всё равно идёт в уборку. Непрочитаемая названная
    // — отказ ниже, в readSegmentVersion.
    const namedKeys = new Set((rowPayload?.segments as Array<{ key: string }> | undefined)?.map(s => s.key) ?? []);
    const segments: CloudSegmentRow[] = [];
    const segPayloads: Array<Record<string, unknown>> = [];
    for (const s of segRows) {
      const dec = await decryptFields(s.payload as Record<string, unknown>, SEGMENT_TEXT_FIELDS);
      const text = typeof dec.messages === 'string' ? dec.messages : null;
      if (text === null && namedKeys.has(s.key)) throw new Error(`M-5: cloud segment ${s.key} has no readable messages`);
      let segStamp: number | undefined;
      const rowStampedAt = (s as { stamped_at?: unknown }).stamped_at;
      if (typeof rowStampedAt === 'number') segStamp = rowStampedAt;
      else if (typeof rowStampedAt === 'string') segStamp = Date.parse(rowStampedAt);
      segments.push({
        key: s.key,
        firstAt: typeof dec.firstAt === 'number' ? dec.firstAt : 0,
        updatedAt: typeof dec.updatedAt === 'number' ? dec.updatedAt : 0,
        messages: text,
        stampedAt: segStamp,
      });
      segPayloads.push(dec);
    }

    if (isSegmented) {
      const headPayload = await decryptFields(rowPayload!, HEAD_TEXT_FIELDS);
      const version = readSegmentVersion([{ key, payload: headPayload }, ...segRows.map((s, i) => ({ key: s.key, payload: segPayloads[i]! }))]);
      if (version === null) throw new Error(`M-5: cloud dialogue ${key}: head-строка есть, но не читается как head`);
      if (version.kind === 'refused') throw new Error(`M-5: cloud dialogue ${key} segments unreadable: ${version.reason}`);
      const at = headPayload.updatedAt;
      const expected = typeof at === 'number' ? at : undefined;
      if (version.kind === 'incomplete') {
        // Head называет окна, которых в облаке нет. Читателю такой набор не
        // отдаётся никогда (см. AIRestoreService), но писателю это сигнал ЧИНИТЬ:
        // он перепишет диалог из локального союза и переподпишет head, а не будет
        // вечно отказываться — иначе повреждённую копию не восстановил бы никто.
        useActivityLogStore.getState().addActivity(
          'activity_dialogue_cloud_unreadable',
          { action: 'uploadDialogue_incomplete_cloud', store: 'aiDialogues', key, missing: version.missing.join(',').slice(0, 200) },
          'warning',
          'sync',
        );
        return { dialogue: version.partial, expected, head: version.head, segments: version.rows.length > 0 ? version.rows : segments, incomplete: version.missing };
      }
      return { dialogue: version.dialogue, expected, head: version.head, segments };
    }

    const rows: CloudRow[] = [];
    if (rowPayload) rows.push({ key, payload: rowPayload });
    for (const p of pages) rows.push({ key: p.key, payload: p.payload as Record<string, unknown> });
    const version = selectCloudVersion(rows);
    // Ни строки `key`, ни прочных страниц: копии диалога в облаке нет. Но если
    // легли сегменты предыдущей оборванной попытки, их надо вернуть — план
    // примет совпадающие окна и снесёт лишнее, а не оставит их сиротами навсегда.
    if (!version) return segments.length > 0 ? { dialogue: null, expected: null, segments } : null;
    if (version.kind === 'refused') throw new Error(`S-49: cloud dialogue ${key} pages unreadable: ${version.reason}`);
    if (version.kind === 'single') {
      const text = await readDialogueText(version.row.payload);
      const at = version.row.payload.updatedAt;
      return { dialogue: JSON.parse(text) as AIDialogue, expected: typeof at === 'number' ? at : undefined, segments };
    }
    let text = '';
    for (const page of version.pages) text += await readDialogueText(page.payload);
    // M-1: условная запись нацелена на строку `key`, значит и expected — её собственное
    // состояние, а не отметка страниц. У копии без манифеста (legacy `key#N` из 0.9.28,
    // стёртый старым табом манифест, обрыв между страницами и манифестом) строки `key`
    // вовсе нет: прежний expected = отметка страниц не совпадал ни с чем, CAS не
    // проходил никогда и диалог > 500 КБ не выгружался вообще.
    const keyStamp = row ? rowPayload!.updatedAt : undefined;
    const expected = row === null ? null : (typeof keyStamp === 'number' ? keyStamp : undefined);
    return { dialogue: JSON.parse(text) as AIDialogue, expected, segments };
  } catch (e) {
    // Строка есть, а прочитать её нельзя — это не «облако пусто»: слепая
    // запись поверх затёрла бы чужой ход. Пусть запись упадёт и повторится.
    if (!unreadableReported.has(key)) {
      unreadableReported.add(key);
      useActivityLogStore.getState().addActivity(
        'activity_dialogue_cloud_unreadable',
        { action: 'uploadDialogue_unreadable', store: 'aiDialogues', key, error: e instanceof Error ? e.message.slice(0, 200) : String(e) },
        'warning',
        'sync',
      );
    }
    throw e;
  }
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
   * SF2-2: путь «оставить моё» включается ТОЛЬКО на проходе явного «отправить
   * всё» (`syncAllLocalStores`), а не на любой ручной выгрузке: `flushPending(true)`
   * вызывают и «синхронизировать сейчас», и дозапись после разблокировки сейфа.
   * На настоящем споре копий такой проход перетирает облачную версию чужого
   * устройства — жест, на который человек нажал кнопку, но не каждый ручной клик.
   */
  private keepMinePass = false;
  // R7Q-007: отложенные повторы уборки сирот, одна запись на пару uid:диалог.
  private orphanRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
    const deletes = uid ? readPersistedDeletes(uid) : [];
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
   * Серверная метка: базовой строке диалога `payload.updatedAt` проставил сервер
   * (миграция 0037), и локальная копия обязана принять это значение. Иначе её
   * собственные часы снова победят следующий спор скаляров, а расхождение — ровно то,
   * из-за чего устройство с часами вперёд держало чужие настройки замороженными —
   * переживало бы перезагрузку. Отпечаток копии (dialogueFingerprint) на updatedAt не
   * смотрит, поэтому само принятие повторной выгрузки не поднимает.
   */
  private async adoptServerStamp(
    uid: string,
    db: Awaited<ReturnType<typeof getLocalDb>>,
    key: string,
  ): Promise<void> {
    const row = await DataProvider.getLocalStoreRecord(uid, 'aiDialogues', key);
    const fromCloud = (row?.payload as Record<string, unknown> | undefined)?.updatedAt;
    if (typeof fromCloud !== 'number' || !Number.isFinite(fromCloud)) return;
    const tx = db.transaction('aiDialogues', 'readwrite');
    const current = await tx.store.get(key);
    if (current && current.updatedAt !== fromCloud) await tx.store.put({ ...current, updatedAt: fromCloud });
    await tx.done;
  }

  /**
   * S0-1 / F-2: после принятой выгрузки скаляра устройство запоминает новую
   * серверную отметку. Без этого скаляр никогда не узнавал, какой версией облака
   * он владеет: `adoptServerStamp` есть только у диалогов, а отметка появлялась
   * лишь при совпадении содержимого на заборе — то есть зависела от везения.
   */
  private async adoptScalarStamp(
    db: Awaited<ReturnType<typeof getLocalDb>>,
    store: SupportedLocalStoreName,
    key: string,
    stampMs: number | null,
    baseJson?: string,
    sentAcknowledged = true,
  ): Promise<void> {
    if (stampMs === null || !Number.isFinite(stampMs)) return;
    const tx = await (db as unknown as {
      transaction(s: string, m: string): Promise<{ store: { get(k: string): Promise<unknown>; put(v: unknown): Promise<unknown> }; done: Promise<void> }>;
    }).transaction(store, 'readwrite');
    const current = await tx.store.get(key);
    // Запись могли снести, пока летел запрос: воскрешать нельзя, и лишнее поле
    // нечего писать в то, чего больше нет.
    if (current && typeof current === 'object' && !Array.isArray(current)
      && (current as Record<string, unknown>)[CLOUD_STAMP_FIELD] !== stampMs) {
      const next: Record<string, unknown> = { ...(current as Record<string, unknown>), [CLOUD_STAMP_FIELD]: stampMs };
      // SF2-2: база — это не только номер ряда, но и его содержимое. Хэш
      // принимается вместе с отметкой: иначе следующее сравнение не отличит
      // «облако двинулось само» от «там чужой текст».
      if (baseJson !== undefined) next[CLOUD_BASE_HASH_FIELD] = contentHash(baseJson);
      // SF2-2: `_cloudSentHashes` означает «эти нагрузки мы положили на сеть и
      // НЕ видели ответа». Принятая запись закрывает список целиком — он гасится,
      // а не перезаписывается хэшем принятой (как у черновика в SF3-1): у скаляра
      // принятое содержимое уже названо полем `_cloudBaseHash`, а второй след
      // переезжал бы обёрткой `put` в строку, у которой ДРУГАЯ база, и чужую
      // облачную версию выдавал бы «нашу» (красный RT-1 в scalarUploadCas.s01).
      if (sentAcknowledged) delete next[CLOUD_SENT_HASHES_FIELD];
      await tx.store.put(next);
    }
    await tx.done;
  }

  /**
   * SF2-2: хэш уехавшей нагрузки пишется ДО запроса. Ответ на запись рвётся уже
   * после коммита на сервере, и без этого следа свою же дошедшую копию приходится
   * читать чужой правкой.
   *
   * SF3-3: след — список, а не один слот. Запрос, который до сервера не дошёл,
   * ничего в облако не положил, но прежним кодом затирал хэш предыдущей, дошедшей
   * без ответа отправки — и доказательство «облако наше» терялось ровно в тот
   * момент, когда оно нужнее всего.
   */
  private async rememberSentHash(
    db: Awaited<ReturnType<typeof getLocalDb>>,
    store: SupportedLocalStoreName,
    key: string,
    localJson: string,
  ): Promise<void> {
    const hash = contentHash(localJson);
    // Отметка об отправке — полезная, а не обязательная: не сумели записать
    // (нет транзакции, нет строки) — выгрузка всё равно идёт. Терять её из-за
    // служебного поля хуже, чем потерять само поле.
    try {
      const tx = await (db as unknown as {
        transaction(s: string, m: string): Promise<{ store: { get(k: string): Promise<unknown>; put(v: unknown): Promise<unknown> }; done: Promise<void> }>;
      }).transaction(store, 'readwrite');
      const current = await tx.store.get(key);
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        const before = readSentHashes((current as Record<string, unknown>)[CLOUD_SENT_HASHES_FIELD]);
        const after = pushSentHash(before, hash);
        if (after !== before) {
          await tx.store.put({ ...(current as Record<string, unknown>), [CLOUD_SENT_HASHES_FIELD]: after });
        }
      }
      await tx.done;
    } catch (err) {
      reportError(err, { action: 'rememberSentHash', store, key }, 'warning');
    }
  }

  /**
   * S0-1 (F-1): выгрузка скалярной строки с условием на серверную отметку базы.
   *
   * База известна — пишем сразу с условием (обычный путь: одна правка, один
   * запрос). Базы нет — сначала одно чтение облака: строки нет → `insert`;
   * облако держит ровно этот JSON → не пишем ничего и принимаем его отметку
   * (иначе каждый проход переставлял бы ряду `stamped_at`, а забор на всех
   * устройствах читал это как правку с чужого — тот же класс, что S-57 у
   * диалогов); иначе условие ставится по отметке прочитанной версии.
   *
   * Ноль строк (конфликт) — перечитать и решить ЗАНОВО, а не писать поверх.
   *
   * SF-1/SF-2 раунда 1 умели только «облако = наша ТЕКУЩАЯ копия → принять».
   * SF2-2: этого мало, и отказ на ложном «чужом» дорог — пять попыток, запись в
   * `ai_sync_dead_upserts`, и каждое следующее её изменение ловит тот же отказ:
   * синхронизация этой записи встаёт с обеих сторон, а признак один — счётчик
   * мёртвых в значке. Чужой правки нет, если облачное содержимое совпадает:
   *   • с хэшем ПОСЛЕДНЕЙ ОТПРАВЛЕННОЙ нагрузки — наша запись дошла до сервера,
   *     а ответ потерялся (на плохой сети это обычный исход);
   *   • с хэшем БАЗЫ — рядом лежит тот же текст, от которого мы правили: слепой
   *     upsert другого устройства («зашифровать всё», «отправить всё», гонка
   *     писателя `{...existing}` с `adoptScalarStamp`) двинул только метку.
   * Тогда принимаем облачную метку как новую базу и ПОВТОРЯЕМ условную запись
   * один раз. Настоящий спор (иное содержимое) остаётся отказом: фоновая выгрузка
   * чужое не затирает. Перетирает только явное «отправить всё» (`forceOwn`) — это
   * путь «оставить моё» из тикета: человек нажал кнопку на этом устройстве, и
   * вилка «править вечно refused» хуже. Проигравшая облачная версия при этом
   * ТЕРЯЕТСЯ — на словах «её устройство не теряет свою копию» неверно: ряд в
   * облаке становится нашим, а на следующем заборе то устройство (если у него нет
   * своей невыгруженной правки) примет нашу копию и локально. Решение владельца —
   * кнопка, а не тихий союз.
   */
  private async uploadScalar(
    uid: string,
    db: Awaited<ReturnType<typeof getLocalDb>>,
    store: SupportedLocalStoreName,
    key: string,
    localJson: string,
    payload: Record<string, unknown>,
    forceOwn = false,
  ): Promise<void> {
    /*gate:clock-rule*/
    // Всё решение «на какую облачную версию я пишу и что делать при отказе» —
    // под разметкой (SF-9): выбор базы, условная запись, разрешение конфликта.
    // Часы устройства здесь запрещены, гейт — src/test/syncRuleGates.s06.test.ts.
    const current = await (db as unknown as { get(s: string, k: string): Promise<unknown> }).get(store, key) as Record<string, unknown> | undefined;
    const remembered = current?.[CLOUD_STAMP_FIELD];
    // SF2-2: сравниваем с тем, что устройство отправляло ПРЕЖДЕ этой попытки:
    // хэш текущей нагрузки облако не может содержать, если её ещё не приняли.
    const rememberedBaseHash = typeof current?.[CLOUD_BASE_HASH_FIELD] === 'string' ? current[CLOUD_BASE_HASH_FIELD] as string : undefined;
    // SF3-3: список неотправленных, а не один слот — слот затирался попыткой,
    // которая до сервера не дошла, и доказательство «облако наше» пропадало.
    const rememberedSentHashes = readSentHashes(current?.[CLOUD_SENT_HASHES_FIELD]);
    let base: number | null = typeof remembered === 'number' && Number.isFinite(remembered) ? remembered : null;

    if (base === null) {
      const cloud = await readCloudScalar(uid, store, key);
      if (cloud === null) {
        base = null; // строки в облаке нет — вставка, а не перезапись
      } else if (cloud.json === localJson) {
        await this.adoptScalarStamp(db, store, key, cloud.stampedAt, cloud.json);
        return;
      } else {
        base = cloud.stampedAt;
      }
    }

    // SF2-1 для ИИ-сторов: след об отправке пишется до запроса. Обрыв ответа
    // после коммита — ровно тот случай, который иначе читается как чужая правка.
    await this.rememberSentHash(db, store, key, localJson);

    const res = await DataProvider.saveLocalStoreRecordIfUnstamped(uid, store, key, payload, base);
    if (res.written) {
      await this.adoptScalarStamp(db, store, key, res.stampedAt, localJson);
      return;
    }
    // Конфликт: перечитать и решить заново, а не писать поверх.
    const cloud = await readCloudScalar(uid, store, key);
    if (cloud === null) {
      // SF-4: базовой строки `key` нет, но её группа страниц `key#N` может лежать
      // в облаке — это правка, у которой текст уложился в одну строку. База локальной
      // копии в этом случае — максимум отметок СТРАНИЦ (так её ставит забор), и
      // условие `.update()` по строке `key` не задевает ничего: «конфликт», перечитка
      // даёт null, отказ «пропала во время выгрузки» — и так пять раз, навсегда.
      await this.uploadScalarOverPages(uid, db, store, key, payload, localJson, base);
      return;
    }
    if (cloud.json === localJson) {
      await this.adoptScalarStamp(db, store, key, cloud.stampedAt, cloud.json);
      return;
    }
    // SF2-7: остаток прежней базовой строки рядом с БОЛЕЕ НОВОЙ полной группой
    // страниц — следствие постраничной выгрузки, упавшей посередине. Забор такой
    // ряд не читает (`selectCloudVersion` берёт свежую полную версию), но CAS
    // целятся именно в строку `key`: условие не проходит, перечитка отдаёт старый
    // текст, и каждая следующая правка ловит тот же отказ до смерти записи.
    // Остаток сносится, и решение уходит в путь SF-4 («страницы → одна строка»),
    // где вставка идёт с проверкой отсутствия.
    if (cloud !== null && DataProvider.deleteLocalStoreExactRecord && await baseRowIsLeftover(uid, store, key, cloud.stampedAt)) {
      await DataProvider.deleteLocalStoreExactRecord(uid, store, key);
      await this.uploadScalarOverPages(uid, db, store, key, payload, localJson, base);
      return;
    }
    // SF2-2: содержимое облака совпало с нашей последней отправкой или с базой,
    // от которой мы правили, — чужой правки нет. Принимаем метку и повторяем.
    const cloudHash = contentHash(cloud.json);
    if (cloud.stampedAt !== null && (rememberedSentHashes.includes(cloudHash) || cloudHash === rememberedBaseHash)) {
      await this.adoptScalarStamp(db, store, key, cloud.stampedAt, cloud.json, false);
      const again = await DataProvider.saveLocalStoreRecordIfUnstamped(uid, store, key, payload, cloud.stampedAt);
      if (again.written) {
        await this.adoptScalarStamp(db, store, key, again.stampedAt ?? cloud.stampedAt, localJson);
        return;
      }
      // Облако двинулось и за время нашей перечитки — пусть следующий проход
      // решает заново по свежим хэшам.
      throw new Error(`S0-1: ${store}/${key} moved again after rebase — retry keeps local copy`);
    }
    if (forceOwn) {
      // Явное «отправить всё» = «оставить моё». Запись идёт вслепую, и только ПОСЛЕ
      // неё перечитывается метка.
      reportError(
        new Error(`S0-1: ${store}/${key} overwritten by explicit «отправить всё» — cloud copy of the other device is replaced`),
        { action: 'sf22_keep_mine_forced', store, key },
        'warning',
      );
      await DataProvider.saveLocalStoreRecord(uid, store, key, payload);
      const written = await readCloudScalar(uid, store, key);
      // SF3-6: принимать можно ТОЛЬКО свою нагрузку. Ряд в окне между слепой
      // записью и перечиткой — это запись другого устройства, и её метка, став
      // нашей базой, означала бы, что следующий условный проход молча перетирает
      // чужую версию: ровно та защита, ради которой CAS и ставился.
      if (written === null || written.json !== localJson) {
        throw new Error(`S0-1: ${store}/${key} was edited during «отправить всё» — local copy kept, cloud stamp not adopted`);
      }
      await this.adoptScalarStamp(db, store, key, written.stampedAt, written.json);
      return;
    }
    throw new Error(`S0-1: ${store}/${key} was edited on another device — local copy kept, not uploaded`);
    /*endgate:clock-rule*/
  }

  /**
   * SF-4: переход «страницы → одна строка».
   *
   * Пока в облаке есть страницы этой записи и их отметка не ушла вперёд от нашей
   * базы, вставка строки `key` — не перезапись чужого: чужая версия это наша же
   * прежняя, разложенная по страницам. Вставка идёт с проверкой отсутствия (23505 =
   * кто-то успел вставить свою строку — это конфликт, а не затирание), а прежние
   * страницы сносит уже стоящий в дренаже `deleteLocalStorePagedRecords` — строго
   * после принятой записи, чтобы при отказе облако осталось целым.
   *
   * Строк ни базовой, ни страниц нет — прежний отказ: «облако пропало посреди
   * выгрузки» не имеет права превращаться в слепую вставку, иначе правка этого
   * устройства воскресила бы удалённое другим.
   */
  private async uploadScalarOverPages(
    uid: string,
    db: Awaited<ReturnType<typeof getLocalDb>>,
    store: SupportedLocalStoreName,
    key: string,
    payload: Record<string, unknown>,
    localJson: string,
    base: number | null,
  ): Promise<void> {
    /*gate:clock-rule*/
    // Решение «можно ли вставить строку поверх группы страниц»: сверяются две
    // серверные метки, часов прибора здесь нет (S0-6, SF-9).
    const pages = DataProvider.getLocalStoreRecordPages
      ? await DataProvider.getLocalStoreRecordPages(uid, store, key)
      : [];
    if (pages.length === 0) {
      throw new Error(`S0-1: cloud row ${store}/${key} disappeared mid-upload`);
    }
    const groupMax = pages.reduce((m, r) => Math.max(m, r.stamped_at ?? 0), 0);
    if (base !== null && groupMax > base) {
      throw new Error(`S0-1: ${store}/${key} pages were edited on another device — local copy kept, not uploaded`);
    }

    const inserted = await DataProvider.saveLocalStoreRecordIfUnstamped(uid, store, key, payload, null);
    /*endgate:clock-rule*/
    if (inserted.written) {
      await this.adoptScalarStamp(db, store, key, inserted.stampedAt, localJson);
      return;
    }
    // 23505: строку `key` вставили, пока мы читали страницы. Решаем по ней заново.
    const again = await readCloudScalar(uid, store, key);
    if (again === null) {
      throw new Error(`S0-1: cloud row ${store}/${key} disappeared mid-upload`);
    }
    if (again.json === localJson) {
      await this.adoptScalarStamp(db, store, key, again.stampedAt, again.json);
      return;
    }
    throw new Error(`S0-1: ${store}/${key} was edited on another device — local copy kept, not uploaded`);
  }

  /**
   * T-4 (R-2): безопасное удаление окон сегментов.
   * Окно может быть удалено ТОЛЬКО если:
   * (a) текущий head, перечитанный непосредственно перед удалением, НЕ называет его;
   * (b) строка старше grace-периода (stamped_at / updatedAt < now() - 10 мин,
   *     где now() — серверная отметка из миграции 0037).
   */
  private async deleteSafeOrphanWindows(
    uid: string,
    key: string,
    candidateKeys: string[],
    knownSegments: CloudSegmentRow[],
  ): Promise<void> {
    if (candidateKeys.length === 0) return;

    // (a) Перечитываем текущий head непосредственно перед удалением
    const currentHeadRow = await DataProvider.getLocalStoreRecord(uid, 'aiDialogues', key);
    const currentPayload = currentHeadRow?.payload as Record<string, unknown> | undefined;
    const currentNamed = new Set<string>();
    if (currentPayload?.head === true && Array.isArray(currentPayload.segments)) {
      for (const s of currentPayload.segments as Array<{ key?: unknown }>) {
        if (typeof s?.key === 'string') currentNamed.add(s.key);
      }
    }

    // Серверное время: отметка stamped_at строки или updatedAt текущего head'а (миграция 0037 ставит серверные часы)
    const rawHeadStamp = (currentHeadRow as { stamped_at?: unknown } | null)?.stamped_at;
    let headStamp: number | undefined;
    if (typeof rawHeadStamp === 'number') headStamp = rawHeadStamp;
    else if (typeof rawHeadStamp === 'string') headStamp = Date.parse(rawHeadStamp);
    const serverNow = headStamp
      ?? (typeof currentPayload?.updatedAt === 'number' && Number.isFinite(currentPayload.updatedAt)
        ? currentPayload.updatedAt
        : Date.now());

    const segMap = new Map<string, number>();
    for (const s of knownSegments) {
      if (typeof s.stampedAt === 'number' && Number.isFinite(s.stampedAt)) {
        segMap.set(s.key, s.stampedAt);
      }
    }

    const toDelete: string[] = [];
    // R7Q-007: окна, оставленные именно из-за grace. Без повтора они не уйдут
    // никогда: следующий проход случается только если тронуть диалог, а
    // надгробие к этому больше не вернётся.
    const deferredByGrace: string[] = [];
    // V-4.4: «оставили, потому что не знаем возраста» — это протекающие строки,
    // и молчать они не имеют права. Без отметки неясно, окно ещё живо или ему
    // год; решение то же (не удалять), но след уходит в warn, чтобы утечка
    // была видна, а не превращалась в «облако понемногу разрастается».
    const unknownStamp: string[] = [];
    for (const candKey of candidateKeys) {
      // (a) Текущий head называет это окно — НЕ удаляем
      if (currentNamed.has(candKey)) continue;

      // (b) Строка должна быть старше grace-периода (10 минут) по серверным часам
      let segStamp = segMap.get(candKey);
      if (segStamp === undefined) {
        const r = await DataProvider.getLocalStoreRecord(uid, 'aiDialogues', candKey);
        const stampedAt = (r as { stamped_at?: unknown } | null)?.stamped_at;
        if (typeof stampedAt === 'number' && Number.isFinite(stampedAt)) {
          segStamp = stampedAt;
        } else if (typeof stampedAt === 'string') {
          const parsed = Date.parse(stampedAt);
          if (Number.isFinite(parsed)) segStamp = parsed;
        }
      }
      // T-8: неизвестный серверный штамп — окно оставляем (никогда не смотрим на device time и не считаем 0 за возраст)
      if (segStamp === undefined) {
        unknownStamp.push(candKey);
        continue;
      }
      if (serverNow - segStamp < ORPHAN_GRACE_PERIOD_MS) {
        deferredByGrace.push(candKey);
        continue;
      }
      toDelete.push(candKey);
    }

    if (unknownStamp.length > 0) {
      logger.warn('LocalStoreSyncService', `orphanCleanupUnknownStamp: kept ${unknownStamp.length} window(s) without a server stamp`, { keys: unknownStamp.join(',') });
    }

    if (toDelete.length > 0) {
      try {
        await DataProvider.deleteLocalStoreRecordsByKeys(uid, 'aiDialogues', toDelete);
      } catch (e) {
        logger.warn('LocalStoreSyncService', `Failed to delete orphan segments: ${String(e)}`);
      }
    }

    if (deferredByGrace.length > 0) {
      this.scheduleOrphanRetry(uid, key);
    }
  }

  /**
   * R7Q-007: одно отложенное возвращение в очередь на диалог. Защита от двойного
   * планирования обязательна: надгробие перечитывается на каждом проходе, и без
   * неё каждое касание диалога добавляло бы по таймеру. Ключ очереди, `deleteGen`
   * и маркеры уже устроены как `store:key` (очередь всегда одного текущего
   * пользователя), поэтому и здесь та же форма; аккаунт проверяется в момент
   * срабатывания.
   */
  private scheduleOrphanRetry(uid: string, key: string): void {
    const token = `aiDialogues:${key}`;
    if (this.orphanRetryTimers.has(token)) return;
    const timer = setTimeout(() => {
      this.orphanRetryTimers.delete(token);
      // Очередь принадлежит текущему пользователю; за 11 минут аккаунт мог
      // смениться, и чужой диалог в неё класть нельзя.
      if (getCurrentUser()?.uid !== uid) return;
      this.scheduleStoreSync('aiDialogues', key);
    }, ORPHAN_RETRY_DELAY_MS);
    this.orphanRetryTimers.set(token, timer);
  }

  /**
   * S-34: облачная копия читается, союз пишется локально (get+merge+put в
   * одной транзакции) и уходит в облако с условием «updatedAt облака не
   * изменился». Ушёл — перечитываем и сливаем заново, до трёх раз; дальше
   * запись падает как обычная ошибка и повторяется штатным путём.
   *
   * S-49: копия крупнее одной страницы тоже читается (строка `key`, страницы
   * `key#…` или сегменты) и пишется с условием.
   *
   * M-5: постраничная ветка записи стала сегментной. Строки окон уходят первыми
   * (одной транзакцией на пачку), последним — head в строке `key` с условием на
   * её прежний `updatedAt`. Head подписывается только когда все его окна уже в
   * облаке, поэтому «половина диалога» не становится читаемой версией: не
   * дописанное окно — это прежний head, а не обрезанный дневник. Проиграли
   * условие — убираем свои строки и сливаем заново; выиграли — убираем строки,
   * которые head больше не называет, и страницы прежней копии.
   */
  private async uploadDialogue(
    uid: string,
    db: Awaited<ReturnType<typeof getLocalDb>>,
    key: string,
  ): Promise<'ok' | 'gone' | 'partial' | { oversized: number }> {
    for (let attempt = 0; ; attempt++) {
      const cloud = await readCloudDialogue(uid, key);
      // null — строки нет (insert); undefined — строка без числовой отметки,
      // условие поставить не на что, пишем как раньше.
      const expected: number | null | undefined = cloud ? cloud.expected : null;

      const tx = db.transaction('aiDialogues', 'readwrite');
      const current = await tx.store.get(key);
      if (!current) { await tx.done; return 'gone'; }
      const merged = cloud?.dialogue
        // Версией облачной копии считается отметка СТРОКИ, которую поставил
        // сервер (миграция 0037), а не время внутри `data`: его сервер не видит
        // (шифр) и часы устройства-источника остаются там навсегда. Без этого
        // устройство с убежавшими часами выигрывало спор скаляров до бесконечности.
        ? mergeDialogues(
          withMessageIds(current),
          typeof expected === 'number' ? { ...cloud.dialogue, updatedAt: expected } : cloud.dialogue,
        )
        : { ...withMessageIds(current), schema: DIALOGUE_SCHEMA };
      const changedLocally = dialogueFingerprint(merged) !== dialogueFingerprint(current);
      if (changedLocally || merged.updatedAt !== current.updatedAt) {
        await tx.store.put(merged);
      }
      await tx.done;
      // S-57: союз лёг в базу — открытый на этом устройстве чат иначе показывает
      // прежнюю копию до следующей своей правки.
      if (changedLocally && typeof window !== 'undefined') window.dispatchEvent(new Event('dialogue-updated'));

      // Облако уже держит ровно эту копию — слать нечего. Запись head'а всё равно
      // ставила бы ему новую серверную отметку (0037), и забор на каждом
      // устройстве принимал её за правку с другого устройства. Прод, 2026-10-07:
      // head длинного диалога переписывался раз в 2 минуты, журнал писал
      // «получено с других устройств: 1» на каждом проходе. Неполная копия
      // (incomplete) и надгробие одиночной строкой (R-3) — не тот случай: их надо
      // дописать/переписать head'ом.
      const cloudIsExact = cloud?.dialogue != null
        && !(cloud.incomplete && cloud.incomplete.length > 0)
        && (cloud.head !== undefined || merged.deletedAt === undefined)
        // Осиротевшие окна убирает только запись head'а — с ними не пропускаем.
        // R7Q-007: окна без head'а (одиночная строка + остатки оборванной
        // попытки) убирает одиночная ветка, и если бы они считались «ровным
        // облаком», повтор после grace выходил бы здесь и до уборки не доходил.
        && (cloud.head === undefined
          ? (cloud.segments ?? []).length === 0
          : staleSegmentKeys(cloud.head, (cloud.segments ?? []).map(r => r.key)).length === 0)
        && dialogueFingerprint(merged) === dialogueFingerprint(cloud.dialogue!);
      if (cloudIsExact) return 'ok';

      const jsonString = JSON.stringify(merged);
      const recordBytes = new TextEncoder().encode(jsonString).length;
      // Потолок размера остаётся прежним: M-5 меняет ФОРМУ записи, а не то,
      // сколько диалог может занять в облаке. Крупнее предела — по-прежнему
      // отметка «слишком большой», а не молчаливая обрезка.
      if (recordBytes > MAX_LOCAL_RECORD_BYTES) return { oversized: recordBytes };
      // M-5: диалог, которому не одна строка, живёт head'ом и сегментами. Прежняя
      // постраничная ветка (`key#<stamp>#<nonce>#p<i>` + манифест) остаётся только
      // для ЧТЕНИЯ: такие копии лежат в облаке и их пишет 0.9.28/0.9.29.
      //
      // Порог прежний: пока диалог влезает в одну строку, он в неё и пишется —
      // клиенты 0.9.28/0.9.29 читают `data` и продолжают получать мелкие диалоги.
      // Сегменты они не читают намеренно (M-3), поэтому переформатировать запись
      // раньше порога значило бы отрезать живые табы от синхронизации.
      //
      // R-3: надгробие — то же исключение наоборот. Одиночной строкой его писать
      // нельзя: 0.9.29 читает любую строку с `data`, игнорирует `deletedAt`,
      // показывает диалог с нулём реплик, а его `cleanupEmpty` через 10 минут
      // сносит строку в облаке — третье устройство тогда никогда не узнает об
      // удалении. Head-форму старый клиент обходит молча, а новый читатель
      // уважает `deletedAt` в head, поэтому надгробие уходит head’ом всегда.
      const useSegments = cloud?.head !== undefined || merged.deletedAt !== undefined || recordBytes > PAGE_SPLIT_THRESHOLD_BYTES;
      if (useSegments) {
        const plan = planDialogue(merged, { head: cloud?.head, segments: cloud?.segments });
        // Head обязан называть только те строки, что уже в облаке: подпись под
        // ненаписанным окном — это «диалог читается наполовину», а readSegmentVersion
        // честно отдаёт по такому head'у отказ. Поэтому крупный диалог доезжает за
        // несколько проходов по PAGES_PER_REQUEST строк, и каждый проход добавляет
        // строго новые байты (записанные окна план переиспользует).
        const batch = plan.toWrite.slice(0, PAGES_PER_REQUEST);
        if (batch.length > 0) {
          const pages: Array<{ key: string; payload: Awaited<ReturnType<typeof maybeEncrypt>> }> = [];
          for (const s of batch) {
            pages.push({ key: s.key, payload: await maybeEncrypt(segmentRowPayload(s), [...SEGMENT_TEXT_FIELDS], [], uid) });
          }
          // Одна транзакция на пачку: полудиалога другой читатель не увидит.
          await DataProvider.saveLocalStoreRecordPages(uid, 'aiDialogues', pages);
        }
        if (plan.toWrite.length > batch.length) return 'partial';

        const headPayload = await maybeEncrypt(headRowPayload(plan.head), [...HEAD_TEXT_FIELDS], [], uid);
        let stored: boolean;
        if (expected === undefined) {
          await DataProvider.saveLocalStoreRecord(uid, 'aiDialogues', key, headPayload);
          stored = true;
        } else {
          stored = await DataProvider.saveLocalStoreRecordIfUnchanged(uid, 'aiDialogues', key, headPayload, expected);
        }
        if (!stored) {
          // R7Q-005: «свои» строки проигравший писал ДО того, как их успел
          // принять победитель: перечитав облако, тот переиспользует ровно эти
          // ключи (байты совпали), и его head называет их. Прежнее безусловное
          // удаление оставляло облако с head'ом на отсутствующее окно — третий
          // читатель по такой ссылке отказывает всему диалогу, а не половине, и
          // чинится только следующей удачной записью того же устройства. Если
          // между удалением и починкой устройство уходит в офлайн — облако
          // остаётся сломанным.
          //
          // Убираем через ту же проверку, что и cleanup победителя: текущий head
          // перечитывается непосредственно перед удалением, названное им окно не
          // удаляется, а остальное дополнительно держится за grace-период —
          // строку мог как раз принять кто-то третий, кто пишет сейчас.
          // Осиротевшие окна проигравшей попытки доживают до штатной уборки.
          if (batch.length > 0) {
            await this.deleteSafeOrphanWindows(uid, key, batch.map(p => p.key), cloud?.segments ?? []);
          }
        } else {
          if (plan.toDelete.length > 0) {
            await this.deleteSafeOrphanWindows(uid, key, plan.toDelete, cloud?.segments ?? []);
          }
          // Миграция: страницы прежней постраничной копии больше не нужны — их
          // место заняли сегменты, названные head'ом.
          if (DataProvider.deleteLocalStorePagedRecords) {
            await DataProvider.deleteLocalStorePagedRecords(uid, 'aiDialogues', key);
          }
          await this.adoptServerStamp(uid, db, key);
          return 'ok';
        }
      } else {
        const encrypted = await maybeEncrypt({ data: jsonString, updatedAt: merged.updatedAt }, ['data'], [], uid);
        let stored: boolean;
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
          // R-2 / T-4: окна, которые не назвал ни один head, этой строкой не описываются
          // и без уборки жили бы вечно. Безопасное удаление: только если текущий head их не назвал
          // и они старше grace-периода (10 мин).
          const orphans = cloud?.segments ?? [];
          if (orphans.length > 0) {
            await this.deleteSafeOrphanWindows(uid, key, orphans.map(s => s.key), orphans);
          }
          await this.adoptServerStamp(uid, db, key);
          return 'ok';
        }
      }
      if (attempt >= 2) throw new Error(`S-34: cloud dialogue ${key} kept changing during upload`);
    }
  }

  private resetTimer(delayMs = DEBOUNCE_DELAY_MS): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flushPending();
    }, delayMs);
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
      // R7Q-006: будильник снят на входе, а очередь полна — без этой строки
      // правки ждали бы, пока человек снова что-нибудь наберёт.
      if (this.pending.size > 0) this.resetTimer(30_000);
      return result;
    }

    // Удаления, пережившие закрытие вкладки, возвращаются в очередь.
    const persistedDeletes = readPersistedDeletes(uid);
    const deleteJournalUnknown = persistedDeletes === null;
    if (deleteJournalUnknown) {
      // Не знаем, какие из ожидающих отправки записей на самом деле удалены.
      // Один upsert воскрешает в облаке снесённый разбор, поэтому удаления
      // этот проход делает, а обновлений — нет (fail closed).
      const rawRes = readPersistedDeletesRaw(uid);
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
    // S0-2 (остаток R3-012): нечитаемый журнал правок — `null`, а не `[]`:
    // «не знаю, что должно уехать» не даёт drain'у ни одной загрузки, ровно как
    // нечитаемый журнал удалений. Битый JSON исцеляется спасением (бэкап +
    // валидные строки), и следующий проход уже работает.
    const persistedUpserts = readPersistedUpserts(uid);
    const upsertJournalUnknown = persistedUpserts === null;
    if (upsertJournalUnknown) {
      const rawRes = readPersistedUpsertsRaw(uid);
      if (!('unavailable' in rawRes) && rawRes.raw !== null) {
        healCorruptUpsertJournal(rawRes.raw, uid);
      }
    } else {
      // SF-8: журнал снова читается — то, что висело в памяти, дописываем сюда и
      // берём в этот же проход.
      const journal = commitMemoryPendingUpserts(uid) ? (readPersistedUpserts(uid) ?? persistedUpserts) : persistedUpserts;
      for (const u of journal) {
        if (u.uid !== uid || !SUPPORTED_LOCAL_STORES.includes(u.store as SupportedLocalStoreName)) continue;
        const k = `${u.store}:${u.key}`;
        if (!this.pending.has(k)) this.pending.set(k, { store: u.store as SupportedLocalStoreName, key: u.key, isDelete: false, attempts: u.attempts ?? 0 });
      }
    }

    if (this.pending.size === 0) return result;
    if (this.isSyncing) {
      // R7Q-006: идущий проход не увидит то, что добавилась после его чтения, и
      // по своим итогам ничего не запланирует.
      if (this.pending.size > 0) this.resetTimer();
      return result;
    }

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
        if ((deleteJournalUnknown || upsertJournalUnknown) && !item.isDelete) {
          // Отложить, а не исполнить: маркер на диске остаётся, обязательство
          // не считается закрытым, и бейдж по-прежнему показывает несданное.
          if (!this.pending.has(itemKey)) this.pending.set(itemKey, item);
          continue;
        }
        try {
          if (item.isDelete) {
            await DataProvider.deleteLocalStoreRecord(uid, item.store, item.key);
            forgetPersistedDelete(uid, item.store, item.key);
            removeOversizedRecord(uid, item.store, item.key);
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
            if (setOversizedRecord(uid, item.store, item.key, recordBytes)) markerChanges.dropped.add(itemKey);
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
            if (outcome === 'partial') {
              // M-5: окна дописаны не все, head ещё не подписан. Обязательство
              // остаётся открытым (маркер не снимаем, бейдж прав), следующий
              // проход продолжает с того места, где встал.
              this.pending.set(itemKey, item);
              this.resetTimer();
              continue;
            }
            if (outcome === 'ok') {
              removeOversizedRecord(uid, item.store, item.key);
              result.synced++;
              markerChanges.dropped.add(itemKey);
              markerChanges.revived.push({ store: item.store, key: item.key });
              continue;
            }
            markOversized(outcome.oversized);
            continue;
          }

          // T-8: отметка облачной версии — служебное поле устройства, в облако не едет.
          const record: unknown = stripCloudStamp(rawRecord);
          const jsonString = JSON.stringify(record);
          const recordBytes = new TextEncoder().encode(jsonString).length;

          // Страниц может выйти на одну больше, чем байт на 8 страниц: край
          // страницы не режет символ. Такая запись тоже не влезает в один запрос.
          const chunks = recordBytes > PAGE_SPLIT_THRESHOLD_BYTES ? splitStringIntoChunks(jsonString, PAGE_SPLIT_THRESHOLD_BYTES) : [jsonString];
          if (recordBytes > MAX_LOCAL_RECORD_BYTES || chunks.length > PAGES_PER_REQUEST) {
            markOversized(recordBytes);
            continue;
          }

          removeOversizedRecord(uid, item.store, item.key);

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

            await this.uploadScalar(uid, db, item.store, item.key, jsonString, encrypted as Record<string, unknown>, this.keepMinePass);
            if (DataProvider.deleteLocalStorePagedRecords) {
              await DataProvider.deleteLocalStorePagedRecords(uid, item.store, item.key);
            }
          } else {
            // SYNC-4: Multi-page split upload
            // S0-1: эта ветка остаётся слепой — ПОСОГЛАСОВАННОЕ исключение тикета.
            // У постраничной записи базовой строки `key` нет (её как раз сносит
            // `deleteLocalStoreExactRecord` ниже), поэтому сравнивать отметку не с
            // чем: группа страниц `key#N` получает по своим `stamped_at` максимум,
            // а условие `.lt(stamped_at, …)` на весь набор — это CAS по самой
            // поздней странице, которая при частичной записи может и не существовать
            // (тот же класс, что M-1 у диалогов: «условие не проходило никогда»).
            // Тикет на починку — в отчёте SYNC0 (S0-1, «не сломать»).
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

    // T-8 (R7F-001): «Отправить всё» не перетирает облачную версию, которой это
    // устройство ещё не видело (её серверная отметка новее той, от которой получена
    // локальная копия). Отметки не читаются — не знаем, что новее: проход не идёт.
    const cloudStamps = new Map<string, number>();
    if (DataProvider.getLocalStoreStamps) {
      try {
        for (const r of await DataProvider.getLocalStoreStamps(userId)) {
          if (typeof r.stamped_at !== 'number') continue;
          const id = `${r.store}:${parseLocalStoreKey(r.key).baseKey}`;
          cloudStamps.set(id, Math.max(cloudStamps.get(id) ?? 0, r.stamped_at));
        }
      } catch (err) {
        reportError(err, { action: 'LocalStoreSyncService_syncAll_stamps' });
        result.failed++;
        return result;
      }
    }

    // SA-1: бэкфилл касается всех записей всех сторов — маркеры пишутся одним
    // блоком, иначе по перезаписи списка на каждую запись.
    const batch: Array<{ store: SupportedLocalStoreName; key: string }> = [];

    // SF3-2: пропуск «метка облака впереди базы» придуман для записей, которые
    // НИЧЕГО не должны. У записи с открытым обязательством (журнал правок,
    // отвергнутые, слишком большие) эта метка впереди ВСЕГДА: забор держит
    // локальную копию и не берёт её, а мёртвые в очереди нет — значит фильтр
    // закрывал «отправить всё» именно для тех, кому он и нужен, и путь «оставить
    // моё» до них не доходил никогда. «Не знаю» (журнал не читается) — тоже не
    // право пропускать: дренаж на нечитаемом журнале и так не отправит ни одной
    // правки, а молча пропущенная запись из тупика не выйдет.
    const obligated = getPendingUpsertKeySet(userId);

    for (const store of SUPPORTED_LOCAL_STORES) {
      if (!db.objectStoreNames.contains(store)) continue;
      try {
        const idb = db as unknown as { getAllKeys(s: string): Promise<IDBValidKey[]>; getAll(s: string): Promise<unknown[]> };
        const allKeys = await idb.getAllKeys(store);
        // Ключи и значения одного стора IndexedDB отдаёт в одном порядке — по ключу.
        const allValues = store === 'aiDialogues' ? [] : await idb.getAll(store);
        for (const [i, key] of allKeys.entries()) {
          /*gate:clock-rule*/
          // «Отправить всё»: ряд пропускается, только если серверная метка облака
          // ушла вперёд от запомненной базы И у ряда нет открытого обязательства.
          // Нечитаемый журнал (`obligated === null`) обязательств НЕ даёт: иначе
          // «отправить всё» присваивало бы чужие новые версии (приёмка SYNC0, M-1).
          // Часы прибора здесь не участвуют (S0-6, SF-9) — сравнение приборного
          // `payload.updatedAt` с серверным уже ломало этот проход (класс S-57).
          const id = `${store}:${String(key)}`;
          const base = (allValues[i] as Record<string, unknown> | undefined)?.[CLOUD_STAMP_FIELD];
          const cloud = cloudStamps.get(id);
          if (typeof base === 'number' && cloud !== undefined && cloud > base && !(obligated !== null && obligated.has(id))) continue;
          /*endgate:clock-rule*/
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
    this.keepMinePass = true;
    try {
      return await this.flushPending(true);
    } finally {
      this.keepMinePass = false;
    }
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
