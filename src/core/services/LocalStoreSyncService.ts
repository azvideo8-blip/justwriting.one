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
  'aiCommitments',
  'aiMonthlyDigest',
  'aiThreads',
  'aiPersonas',
] as const;

export type SupportedLocalStoreName = typeof SUPPORTED_LOCAL_STORES[number];

export const MAX_LOCAL_RECORD_BYTES = 500 * 1024; // 500 KB limit per record

const OVERSIZED_LS_KEY = 'ai_sync_oversized_records';
const DEBOUNCE_DELAY_MS = 1500;

interface PendingSyncItem {
  store: SupportedLocalStoreName;
  key: string;
  isDelete?: boolean;
}

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
  if (typeof obj.lastReinforcedAt === 'string') {
    const ms = Date.parse(obj.lastReinforcedAt);
    if (!isNaN(ms)) return ms;
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

  public scheduleStoreSync(store: SupportedLocalStoreName, key: string): void {
    const itemKey = `${store}:${key}`;
    this.pending.set(itemKey, { store, key, isDelete: false });
    this.resetTimer();
  }

  public scheduleStoreDelete(store: SupportedLocalStoreName, key: string): void {
    const itemKey = `${store}:${key}`;
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

    const result = { synced: 0, failed: 0, skippedLocked: false, skippedOversized: 0 };
    const uid = getCurrentUser()?.uid;
    if (!uid) return result;

    // SEC-8: Background upload respects cloudSyncEnabled switch.
    // Manual / backfill actions (forceManual = true) are explicitly exempt.
    if (!forceManual && !cloudSyncEnabled()) {
      return result;
    }

    // Check encryption status: if encryption enabled but session key locked, postpone!
    if (getEncryptionEnabled(uid) && !getSessionKey()) {
      result.skippedLocked = true;
      return result;
    }

    if (this.pending.size === 0) return result;
    if (this.isSyncing) return result;

    this.isSyncing = true;
    const items = Array.from(this.pending.values());
    this.pending.clear();

    const db = await getLocalDb();

    for (const item of items) {
      const itemKey = `${item.store}:${item.key}`;
      try {
        if (item.isDelete) {
          await DataProvider.deleteLocalStoreRecord(uid, item.store, item.key);
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

        const jsonString = JSON.stringify(rawRecord);
        const recordBytes = new TextEncoder().encode(jsonString).length;

        if (recordBytes > MAX_LOCAL_RECORD_BYTES) {
          setOversizedRecord(item.store, item.key, recordBytes);
          result.skippedOversized++;
          logger.warn('LocalStoreSyncService', `Record too large to sync (${recordBytes} bytes): ${item.store}/${item.key}`);
          useActivityLogStore.getState().addActivity(
            `Запись ${item.store}/${item.key} (${Math.round(recordBytes / 1024)} КБ) превышает лимит размера 500 КБ и остаётся только на устройстве`,
            { action: 'localStoreSync_oversized', store: item.store, key: item.key, bytes: recordBytes },
            'warning',
            'sync'
          );
          continue;
        }

        removeOversizedRecord(item.store, item.key);

        const recordTs = extractRecordTimestamp(rawRecord) ?? Date.now();

        // Encrypt record data with vault key
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
        }
      }
    }

    this.isSyncing = false;
    return result;
  }

  public async syncAllLocalStores(userId: string): Promise<{ synced: number; failed: number; skippedLocked: boolean; skippedOversized: number }> {
    const result = { synced: 0, failed: 0, skippedLocked: false, skippedOversized: 0 };
    if (!userId) return result;

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
