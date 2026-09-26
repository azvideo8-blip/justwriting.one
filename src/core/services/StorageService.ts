import { withDocumentLock } from '../sync/withDocumentLock';
import { getLocalDb } from '../storage/localDb';
import { LocalStorageService } from './LocalStorageService';
import { LocalDocumentService } from './LocalDocumentService';
import { DocumentService } from './DocumentService';
import { CloudSyncService } from './CloudSyncService';
import { ProfileUpdater } from './ProfileUpdater';
import { SaveDocumentData, StorageState } from './storageTypes';
import { withTimeout } from '../../shared/utils/withTimeout';
import { reportError } from '../../shared/errors/reportError';
import { getEncryptionEnabled } from '../crypto/cryptoHelpers';
import { isVersionContentTooLarge } from './VersionService';
import { cloudSyncEnabled } from '../sync/cloudSyncEnabled';
import { addToSyncQueue } from './syncQueueOps';

export type { StorageState, SaveDocumentData } from './storageTypes';
export { CLOUD_COPY_LOCAL_ONLY, CLOUD_COPY_TOMBSTONE } from './CloudSyncService';

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

async function deleteDocumentUnlocked(userId: string, localId?: string, cloudId?: string): Promise<{ cloudSynced: boolean; derivativesOk: boolean }> {
  let targetCloudId = cloudId;
  if (localId && !targetCloudId) {
    try {
      const fresh = await LocalStorageService.getDocument(localId);
      if (fresh?.linkedCloudId) targetCloudId = fresh.linkedCloudId;
    } catch { /* ignore */ }
  }
  let derivativesOk = true;
  if (localId) {
    derivativesOk = await LocalStorageService.deleteDocument(localId);
  }
  let cloudSynced = true;
  if (targetCloudId) {
    try {
      await CloudSyncService.removeCloudCopy(userId, targetCloudId);
    } catch (e) {
      cloudSynced = false;
      reportError(e, { action: 'deleteDocument_cloudDelete', documentId: targetCloudId });
      const db = await getLocalDb();
      await db.put('syncQueue', {
        id: `delete_${targetCloudId}_${Date.now()}`,
        documentId: targetCloudId,
        type: 'delete' as const,
        createdAt: Date.now(),
        ownerId: userId,
      });
    }
  }
  return { cloudSynced, derivativesOk };
}

export const StorageService = {
  async saveNew(userId: string, data: SaveDocumentData): Promise<{ localId: string }> {
    return LocalStorageService.saveNew(userId, data);
  },

  async saveVersion(userId: string, documentId: string, data: SaveDocumentData): Promise<SaveVersionResult> {
    return _lockManager.acquire(documentId, () => withTimeout(_doSaveVersion(userId, documentId, data), 60_000, 'Sync timeout'));
  },

  async addLocalCopy(userId: string, cloudDocumentId: string): Promise<string> {
    return CloudSyncService.addLocalCopy(userId, cloudDocumentId);
  },

  async addCloudCopy(userId: string, localDocumentId: string, _encryptionRequired = true): Promise<string> {
    return _lockManager.acquire(localDocumentId, () => CloudSyncService.addCloudCopy(userId, localDocumentId, _encryptionRequired));
  },

  async removeLocalCopy(localDocumentId: string): Promise<boolean> {
    return LocalStorageService.deleteDocument(localDocumentId);
  },

  async removeCloudCopy(userId: string, cloudDocumentId: string, localDocumentId?: string): Promise<void> {
    return CloudSyncService.removeCloudCopy(userId, cloudDocumentId, localDocumentId);
  },

  async trashDocument(userId: string, localId?: string, cloudId?: string): Promise<{ cloudSynced: boolean }> {
    let targetCloudId = cloudId;
    if (localId && !targetCloudId) {
      try {
        const fresh = await LocalStorageService.getDocument(localId);
        if (fresh?.linkedCloudId) targetCloudId = fresh.linkedCloudId;
      } catch { /* ignore */ }
    }
    const now = Date.now();
    if (localId) {
      await LocalDocumentService.trashDocument(localId, now);
    }
    let cloudSynced = true;
    if (targetCloudId && !userId.startsWith('guest')) {
      try {
        await DocumentService.trashDocument(userId, targetCloudId, new Date(now));
      } catch (e) {
        cloudSynced = false;
        reportError(e, { action: 'trashDocument_cloud', documentId: targetCloudId });
        if (localId) {
          // N2-1: задача 'document' без флага досылала только версии — корзина,
          // изменённая без связи, до облака не доходила никогда.
          await LocalDocumentService.setMetadataDirty(localId, true);
          const db = await getLocalDb();
          await db.put('syncQueue', {
            id: `doc_${localId}_${Date.now()}`,
            documentId: localId,
            type: 'document' as const,
            createdAt: Date.now(),
            ownerId: userId,
          });
        }
      }
    }
    return { cloudSynced };
  },

  async restoreDocument(userId: string, localId?: string, cloudId?: string): Promise<{ cloudSynced: boolean }> {
    let targetCloudId = cloudId;
    if (localId && !targetCloudId) {
      try {
        const fresh = await LocalStorageService.getDocument(localId);
        if (fresh?.linkedCloudId) targetCloudId = fresh.linkedCloudId;
      } catch { /* ignore */ }
    }
    if (localId) {
      await LocalDocumentService.restoreDocument(localId);
    }
    let cloudSynced = true;
    if (targetCloudId && !userId.startsWith('guest')) {
      try {
        await DocumentService.restoreDocument(userId, targetCloudId);
      } catch (e) {
        cloudSynced = false;
        reportError(e, { action: 'restoreDocument_cloud', documentId: targetCloudId });
        if (localId) {
          // N2-1: задача 'document' без флага досылала только версии — корзина,
          // изменённая без связи, до облака не доходила никогда.
          await LocalDocumentService.setMetadataDirty(localId, true);
          const db = await getLocalDb();
          await db.put('syncQueue', {
            id: `doc_${localId}_${Date.now()}`,
            documentId: localId,
            type: 'document' as const,
            createdAt: Date.now(),
            ownerId: userId,
          });
        }
      }
    }
    return { cloudSynced };
  },

  async deleteDocument(userId: string, localId?: string, cloudId?: string): Promise<{ cloudSynced: boolean; derivativesOk: boolean }> {
    if (!localId) return deleteDocumentUnlocked(userId, localId, cloudId);
    // R3-10: если дренаж как раз выгружает эту заметку впервые, облачный ряд
    // появится уже после удаления локальной — и downloadAllFromCloud её вернёт.
    // Ждём, пока выгрузка отпустит заметку, и удаляем под тем же замком.
    // ponytail: ждём до ~10 с, дальше удаляем как раньше, без замка.
    for (let i = 0; i < 20; i++) {
      const res = await withDocumentLock(localId, () => deleteDocumentUnlocked(userId, localId, cloudId), {
        queueOnHeld: false,
        onLockHeld: () => null,
      });
      if (res) return res;
      await new Promise(r => setTimeout(r, 500));
    }
    return deleteDocumentUnlocked(userId, localId, cloudId);
  },

  async getStorageState(userId: string, localId?: string, cloudId?: string): Promise<StorageState> {
    const [localExists, cloudExists] = await Promise.all([
      localId ? LocalStorageService.getDocument(localId).then(d => !!d) : Promise.resolve(false),
      cloudId ? CloudSyncService.getDocument(userId, cloudId).then(d => !!d) : Promise.resolve(false),
    ]);
    return { local: localExists, cloud: cloudExists };
  },
};

export type SaveVersionResult = {
  forked: boolean;
  forkTitle?: string | undefined;
  cloudSynced: boolean;
  reason?: string | undefined;
  isTooLarge?: boolean | undefined;
};

async function _doSaveVersion(userId: string, documentId: string, data: SaveDocumentData): Promise<SaveVersionResult> {
  const db = await getLocalDb();
  const now = Date.now();
  const totalWords = data.documentWordCount ?? data.wordCount;

  const res = await LocalStorageService.saveVersionToLocal(db, documentId, data, now);
  if (!res.ok) {
    throw new DOMException('Local save failed (quota exceeded)', 'QuotaExceededError');
  }
  const { newVersion, prevContent, existing } = res;

  // Сигнал AI-домену (#105): правки должны догонять индекс эмбеддингов,
  // а не только при открытии страницы ИИ. Слушатель в features/ai вызывает
  // indexDocument — тот сам гейтируется согласием и хешем контента.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('doc-version-saved', { detail: { documentId } }));
  }

  await ProfileUpdater.updateLocalProfile(
    existing.guestId,
    existing.totalWords,
    totalWords,
    existing.totalDuration,
    data.duration,
    now
  );

  const isEncrypted = Boolean(getEncryptionEnabled(userId));
  const isTooLarge = isVersionContentTooLarge(data.content, isEncrypted);
  if (isTooLarge) {
    return { forked: false, cloudSynced: false, reason: 'TOO_LARGE', isTooLarge: true };
  }

  if (existing.linkedCloudId) {
    if (!cloudSyncEnabled(userId)) {
      await addToSyncQueue(documentId);
      return { forked: false, cloudSynced: false };
    }
    const result = await CloudSyncService.syncVersionToCloud(
      userId,
      documentId,
      existing.linkedCloudId,
      data,
      newVersion,
      prevContent
    );
    if (result.forked) return { forked: true, forkTitle: result.forkTitle, cloudSynced: false };
    return { forked: false, cloudSynced: result.cloudSynced, reason: result.reason };
  }
  return { forked: false, cloudSynced: false };
}
