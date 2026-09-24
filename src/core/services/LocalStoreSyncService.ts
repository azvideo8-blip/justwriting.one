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

interface PersistedDelete { uid: string; store: string; key: string }

function readPersistedDeletes(): PersistedDelete[] {
  try {
    const raw = localStorage.getItem(PENDING_DELETES_LS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as PersistedDelete[]) : [];
  } catch {
    return [];
  }
}

function writePersistedDeletes(list: PersistedDelete[]): void {
  try { localStorage.setItem(PENDING_DELETES_LS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

function persistDelete(uid: string, store: string, key: string): void {
  const list = readPersistedDeletes();
  if (!list.some(d => d.uid === uid && d.store === store && d.key === key)) {
    list.push({ uid, store, key });
    writePersistedDeletes(list);
  }
}

function forgetPersistedDelete(uid: string, store: string, key: string): void {
  writePersistedDeletes(readPersistedDeletes().filter(d => !(d.uid === uid && d.store === store && d.key === key)));
}

/** Ключи `store:key`, облачное удаление которых ещё не дошло — восстановлению их не трогать. */
export function getPendingStoreDeleteKeys(uid: string): Set<string> {
  return new Set(readPersistedDeletes().filter(d => d.uid === uid).map(d => `${d.store}:${d.key}`));
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
  } catch { /* ignore */ }
}

class LocalStoreSyncManager {
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
    this.pending.set(itemKey, { store, key, isDelete: false });
    this.resetTimer();
  }

  public scheduleStoreDelete(store: SupportedLocalStoreName, key: string): void {
    const itemKey = `${store}:${key}`;
    const uid = getCurrentUser()?.uid;
    if (uid) persistDelete(uid, store, key);
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
    for (const d of readPersistedDeletes()) {
      if (d.uid !== uid || !SUPPORTED_LOCAL_STORES.includes(d.store as SupportedLocalStoreName)) continue;
      const k = `${d.store}:${d.key}`;
      if (!this.pending.has(k)) this.pending.set(k, { store: d.store as SupportedLocalStoreName, key: d.key, isDelete: true });
    }

    if (this.pending.size === 0) return result;
    if (this.isSyncing) return result;

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
        try {
          if (item.isDelete) {
            await DataProvider.deleteLocalStoreRecord(uid, item.store, item.key);
            forgetPersistedDelete(uid, item.store, item.key);
            removeOversizedRecord(item.store, item.key);
            result.synced++;
            continue;
          }

          // Get record from IDB
          const rawRecord = await (db as unknown as { get(s: string, k: string): Promise<unknown> }).get(item.store, item.key);
          if (rawRecord === undefined) {
            // If record does not exist locally anymore, skip or delete from cloud
            continue;
          }

          // Belt-and-braces: refuse to upload records belonging to another user
          if (rawRecord && typeof rawRecord === 'object') {
            const owner = (rawRecord as { userId?: string; ownerId?: string; guestId?: string }).userId
              ?? (rawRecord as { userId?: string; ownerId?: string; guestId?: string }).ownerId
              ?? (rawRecord as { userId?: string; ownerId?: string; guestId?: string }).guestId;
            if (owner && owner !== uid) {
              continue;
            }
          }

          const jsonString = JSON.stringify(rawRecord);
          const recordBytes = new TextEncoder().encode(jsonString).length;

          if (recordBytes > MAX_LOCAL_RECORD_BYTES) {
            setOversizedRecord(item.store, item.key, recordBytes);
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

            for (let i = 0; i < totalPages; i++) {
              const pageKey = `${item.key}#${i}`;
              const encrypted = await maybeEncrypt(
                {
                  data: chunks[i],
                  updatedAt: recordTs,
                  page: i,
                  totalPages,
                },
                ['data'],
                [],
                uid,
              );
              await DataProvider.saveLocalStoreRecord(
                uid,
                item.store,
                pageKey,
                encrypted,
              );
            }
            // Clean up stale unpaged record row if previously stored unpaged
            if (DataProvider.deleteLocalStoreExactRecord) {
              await DataProvider.deleteLocalStoreExactRecord(uid, item.store, item.key);
            }
          }
          result.synced++;
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
            } else if ((item.attempts ?? 0) + 1 < MAX_UPSERT_ATTEMPTS && !this.pending.has(itemKey)) {
              // R3-8: обновление читается из IDB заново, так что повтор отправит
              // свежую версию; новое изменение за время прохода не перетираем.
              this.pending.set(itemKey, { ...item, attempts: (item.attempts ?? 0) + 1 });
            }
          }
        }
      }
    } finally {
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

    const db = await getLocalDb();

    for (const store of SUPPORTED_LOCAL_STORES) {
      if (!db.objectStoreNames.contains(store)) continue;
      try {
        const allKeys = await (db as unknown as { getAllKeys(s: string): Promise<IDBValidKey[]> }).getAllKeys(store);
        for (const key of allKeys) {
          this.scheduleStoreSync(store, String(key));
        }
      } catch (err) {
        reportError(err, { action: 'LocalStoreSyncService_syncAll_store', store });
      }
    }

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
