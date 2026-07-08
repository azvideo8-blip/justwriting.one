import { getLocalDb } from '../storage/localDb';
import { LocalStorageService } from './LocalStorageService';
import { CloudSyncService } from './CloudSyncService';
import { ProfileUpdater } from './ProfileUpdater';
import { SaveDocumentData, StorageState } from './storageTypes';
import { withTimeout } from '../../shared/utils/withTimeout';
import { reportError } from '../../shared/errors/reportError';

export type { StorageState, SaveDocumentData } from './storageTypes';

class LockManager {
  private locks = new Map<string, Promise<void>>();

  async acquire<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) || Promise.resolve();
    let result: T | undefined;
    const next = prev.then(
      async () => { result = await fn(); },
      async (prevErr) => { throw prevErr; },
    );
    const stored = next.then(() => {}, () => {});
    this.locks.set(key, stored);
    try {
      await next;
    } finally {
      if (this.locks.get(key) === stored) this.locks.delete(key);
    }
    return result!;
  }
}

const _lockManager = new LockManager();

export const StorageService = {
  async saveNew(userId: string, data: SaveDocumentData): Promise<{ localId: string }> {
    return LocalStorageService.saveNew(userId, data);
  },

  async saveVersion(userId: string, documentId: string, data: SaveDocumentData): Promise<{ forked: boolean }> {
    return _lockManager.acquire(documentId, () => withTimeout(_doSaveVersion(userId, documentId, data), 60_000, 'Sync timeout'));
  },

  async addLocalCopy(userId: string, cloudDocumentId: string): Promise<string> {
    return CloudSyncService.addLocalCopy(userId, cloudDocumentId);
  },

  async addCloudCopy(userId: string, localDocumentId: string, _encryptionRequired = true): Promise<string> {
    return _lockManager.acquire(localDocumentId, () => CloudSyncService.addCloudCopy(userId, localDocumentId, _encryptionRequired));
  },

  async removeLocalCopy(localDocumentId: string): Promise<void> {
    return LocalStorageService.deleteDocument(localDocumentId);
  },

  async removeCloudCopy(userId: string, cloudDocumentId: string, localDocumentId?: string): Promise<void> {
    return CloudSyncService.removeCloudCopy(userId, cloudDocumentId, localDocumentId);
  },

  async deleteDocument(userId: string, localId?: string, cloudId?: string): Promise<void> {
    if (localId) {
      await LocalStorageService.deleteDocument(localId);
    }
    if (cloudId) {
      try {
        await CloudSyncService.removeCloudCopy(userId, cloudId);
      } catch (e) {
        reportError(e, { action: 'deleteDocument_cloudDelete', documentId: cloudId });
        const db = await getLocalDb();
        await db.put('syncQueue', {
          id: `delete_${cloudId}_${Date.now()}`,
          documentId: cloudId,
          type: 'delete' as const,
          createdAt: Date.now(),
        });
      }
    }
  },

  async getStorageState(userId: string, localId?: string, cloudId?: string): Promise<StorageState> {
    const [localExists, cloudExists] = await Promise.all([
      localId ? LocalStorageService.getDocument(localId).then(d => !!d) : Promise.resolve(false),
      cloudId ? CloudSyncService.getDocument(userId, cloudId).then(d => !!d) : Promise.resolve(false),
    ]);
    return { local: localExists, cloud: cloudExists };
  },
};

async function _doSaveVersion(userId: string, documentId: string, data: SaveDocumentData): Promise<{ forked: boolean }> {
  const db = await getLocalDb();
  const tx = db.transaction(['documents', 'versions'], 'readonly');
  const docStore = tx.objectStore('documents');
  const verStore = tx.objectStore('versions');

  const existing = await docStore.get(documentId);
  if (!existing) {
    await tx.done;
    throw new Error('Document not found');
  }

  const prevVer = await verStore.index('by-doc-version').get([documentId, existing.currentVersion]);
  const prevContent = prevVer?.content ?? '';
  await tx.done;

  const newVersion = existing.currentVersion + 1;
  const totalWords = data.documentWordCount ?? data.wordCount;
  const now = Date.now();

  const localSaveOk = await LocalStorageService.saveVersionToLocal(db, documentId, data, existing, newVersion, prevContent, now);

  if (localSaveOk) {
    await ProfileUpdater.updateLocalProfile(
      existing.guestId,
      existing.totalWords,
      totalWords,
      existing.totalDuration,
      data.duration,
      now
    );
  } else {
    throw new DOMException('Local save failed (quota exceeded)', 'QuotaExceededError');
  }

  if (existing.linkedCloudId) {
    const result = await CloudSyncService.syncVersionToCloud(
      userId,
      documentId,
      existing.linkedCloudId,
      data,
      newVersion,
      prevContent
    );
    if (result.forked) return { forked: true };
  }
  return { forked: false };
}
