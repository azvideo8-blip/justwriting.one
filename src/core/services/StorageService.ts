import { DocumentService } from './DocumentService';
import { VersionService } from '../../features/writing/services/VersionService';
import { LocalDocumentService } from './LocalDocumentService';
import { LocalVersionService } from '../../features/writing/services/LocalVersionService';
import { getLocalDb, randomUUID, LocalDocument } from '../storage/localDb';
import { toDate } from '../utils/dateUtils';
import { computeWordDelta } from '../../features/writing/services/DiffService';
import { maybeEncrypt, maybeDecrypt, type VersionEncryptPayload } from '../crypto/cryptoHelpers';
import { reportError } from '../errors/reportError';
import { isFirestoreConnected } from '../firebase/firestore';

export interface StorageState {
  local: boolean;
  cloud: boolean;
}

export interface SaveDocumentData {
  title: string;
  content: string;
  wordCount: number;
  documentWordCount?: number;
  duration: number;
  wpm: number;
  tags: string[];
  labelId?: string;
  goalWords?: number;
  goalTime?: number;
  goalReached?: boolean;
  sessionStartedAt: Date;
  mood?: string;
}

const CLOUD_SYNC_TIMEOUT = 30_000;
const LOCK_TTL_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number = CLOUD_SYNC_TIMEOUT): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Sync timeout')), ms); }),
  ]).finally(() => clearTimeout(timer));
}

const _saveVersionLocks = new Map<string, Promise<void>>();

export const StorageService = {
  async saveNew(
    userId: string,
    data: SaveDocumentData
  ): Promise<{ localId: string }> {
    const localId = await LocalDocumentService.createDocument(userId, {
      title: data.title,
      tags: data.tags,
      labelId: data.labelId,
    });
    await LocalVersionService.addVersion(userId, localId, {
      content: data.content,
      previousContent: '',
      wordCount: data.wordCount,
      duration: data.duration,
      wpm: data.wpm,
      versionNumber: 1,
      goalWords: data.goalWords,
      goalTime: data.goalTime,
      goalReached: data.goalReached,
      sessionStartedAt: data.sessionStartedAt,
      mood: data.mood,
    });
    await LocalDocumentService.updateAfterSession(localId, {
      totalWords: data.documentWordCount ?? data.wordCount,
      totalDuration: data.duration,
      currentVersion: 1,
      mood: data.mood,
    });
    return { localId };
  },

  async saveVersion(
    userId: string,
    documentId: string,
    data: SaveDocumentData
  ): Promise<void> {
    const prevPromise = _saveVersionLocks.get(documentId);
    if (prevPromise) {
      try { await prevPromise; } catch (prevErr) { reportError(prevErr, { action: 'saveVersion', documentId }); }
    }
    const promise = _doSaveVersion(userId, documentId, data);
    _saveVersionLocks.set(documentId, promise);
    try {
      await withTimeout(promise, 60_000);
    } finally {
      if (_saveVersionLocks.get(documentId) === promise) {
        _saveVersionLocks.delete(documentId);
      }
    }
  },

  async addLocalCopy(userId: string, cloudDocumentId: string): Promise<string> {
    const allLocal = await LocalDocumentService.getGuestDocuments(userId);
    const existing = allLocal.find(d => d.linkedCloudId === cloudDocumentId);
    if (existing) return existing.id;

    const cloudDoc = await DocumentService.getDocument(userId, cloudDocumentId);
    if (!cloudDoc) throw new Error('Cloud document not found');

    const versions = await VersionService.getVersions(userId, cloudDocumentId);
    const firstSessionMs = toDate(cloudDoc.firstSessionAt)?.getTime() ?? undefined;
    const lastSessionMs = toDate(cloudDoc.lastSessionAt)?.getTime() ?? undefined;
    const localId = await LocalDocumentService.createDocument(userId, {
      title: cloudDoc.title,
      tags: cloudDoc.tags,
      labelId: cloudDoc.labelId ?? undefined,
      firstSessionAt: firstSessionMs ?? undefined,
      lastSessionAt: lastSessionMs ?? undefined,
    });

    try {
      let prevContent = '';
      for (const ver of versions) {
        let startedAt = toDate(ver.sessionStartedAt) ?? toDate(ver.savedAt) ?? new Date();
        if (isNaN(startedAt.getTime())) startedAt = new Date();

        const decryptedVer = await maybeDecrypt(ver, ['content'], []);
        const verContent = (decryptedVer.content as string) ?? ver.content;

        await LocalVersionService.addVersion(userId, localId, {
          content: verContent,
          previousContent: prevContent,
          wordCount: ver.wordCount,
          duration: ver.duration,
          wpm: ver.wpm,
          versionNumber: ver.version ?? 1,
          goalWords: ver.goalWords,
          goalTime: ver.goalTime,
          goalReached: ver.goalReached,
          sessionStartedAt: startedAt,
        });
        prevContent = verContent;
      }

      await LocalDocumentService.updateDocument(localId, {
        totalWords: cloudDoc.totalWords,
        totalDuration: cloudDoc.totalDuration,
        currentVersion: cloudDoc.currentVersion,
        sessionsCount: cloudDoc.sessionsCount ?? 1,
      });

      await LocalDocumentService.updateLinkedCloudId(localId, cloudDocumentId);
    } catch (e) {
      reportError(e, { action: 'addLocalCopy', cloudDocumentId });
      try { await LocalDocumentService.deleteDocument(localId); } catch (cleanupErr) {
        reportError(cleanupErr, { action: 'addLocalCopy_cleanup', localId });
      }
      throw e;
    }

    return localId;
  },

  async addCloudCopy(userId: string, localDocumentId: string, _encryptionRequired = true): Promise<string> {
    if (!isFirestoreConnected) {
      throw new Error('Not connected to cloud. Changes saved locally.');
    }
    const db = await getLocalDb();
    const lockKey = `lock_cloud_${localDocumentId}`;

    // Atomic check+claim via IDB transaction
    const lockTx = db.transaction('syncQueue', 'readwrite');
    const existing = await lockTx.store.get(lockKey);
    if (existing) {
      const age = Date.now() - (existing.createdAt ?? 0);
      if (age < LOCK_TTL_MS) {
        await lockTx.done;
        return '';
      }
    }
    await lockTx.store.put({ id: lockKey, documentId: localDocumentId, type: 'document' as const, createdAt: Date.now() });
    await lockTx.done;

    try {
      const localDoc = await LocalDocumentService.getDocument(localDocumentId);
      if (!localDoc) throw new Error('Local document not found');

      if (localDoc.linkedCloudId) {
        const existing = await withTimeout(DocumentService.getDocument(userId, localDoc.linkedCloudId));
        if (existing) return localDoc.linkedCloudId;
        await LocalDocumentService.updateLinkedCloudId(localDocumentId, '');
      }

      const versions = await LocalVersionService.getVersions(localDocumentId);
      let cloudId: string | null = null;

      try {
        cloudId = await withTimeout(DocumentService.createDocument(userId, {
          title: localDoc.title,
          tags: localDoc.tags,
          labelId: localDoc.labelId ?? undefined,
          firstSessionAt: localDoc.firstSessionAt ? new Date(localDoc.firstSessionAt) : undefined,
          lastSessionAt: localDoc.lastSessionAt ? new Date(localDoc.lastSessionAt) : undefined,
        }));

        let prevContent = '';
        for (const ver of versions) {
          const startedAt = ver.sessionStartedAt != null
            ? new Date(ver.sessionStartedAt)
            : new Date(ver.savedAt || Date.now());
          if (isNaN(startedAt.getTime())) {
            throw new Error(`Invalid sessionStartedAt for version ${ver.id}`);
          }

          const versionPayload = await maybeEncrypt({
            content: ver.content,
            previousContent: prevContent,
            wordCount: ver.wordCount,
            duration: ver.duration,
            wpm: ver.wpm,
            versionNumber: ver.version,
            goalWords: ver.goalWords,
            goalTime: ver.goalTime,
            goalReached: ver.goalReached,
            sessionStartedAt: startedAt,
          } satisfies VersionEncryptPayload, ['content', 'previousContent'], [], userId);

          await withTimeout(VersionService.addVersion(userId, cloudId, {
            content: versionPayload.content as string,
            previousContent: versionPayload.previousContent as string,
            wordCount: ver.wordCount,
            duration: ver.duration,
            wpm: ver.wpm,
            versionNumber: ver.version,
            goalWords: ver.goalWords,
            goalTime: ver.goalTime,
            goalReached: ver.goalReached,
            sessionStartedAt: startedAt,
            _encrypted: versionPayload._encrypted as boolean | undefined,
          }));
          prevContent = ver.content;
        }

        await withTimeout(DocumentService.updateDocumentAfterSession(userId, cloudId, {
          totalWords: localDoc.totalWords,
          totalDuration: localDoc.totalDuration,
          currentVersion: localDoc.currentVersion,
        }));
      } catch (e) {
        if (cloudId) {
          try { await DocumentService.deleteDocument(userId, cloudId); } catch (cleanupErr) { reportError(cleanupErr, { action: 'addCloudCopy_cleanup', cloudId }); }
        }
        throw e;
      }

      if (!cloudId) throw new Error('Failed to create cloud document');
      await LocalDocumentService.updateLinkedCloudId(localDocumentId, cloudId);
      await LocalDocumentService.migrateDocumentOwner(localDocumentId, userId);
      return cloudId;
    } finally {
      try {
        const cleanupDb = await getLocalDb();
        await cleanupDb.delete('syncQueue', lockKey);
      } catch (cleanupErr) { reportError(cleanupErr, { action: 'addCloudCopy_lockCleanup', lockKey }); }
    }
  },

  async removeLocalCopy(localDocumentId: string): Promise<void> {
    await LocalDocumentService.deleteDocument(localDocumentId);
  },

  async removeCloudCopy(userId: string, cloudDocumentId: string, localDocumentId?: string): Promise<void> {
    await DocumentService.deleteDocument(userId, cloudDocumentId);
    if (localDocumentId) {
      await LocalDocumentService.updateLinkedCloudId(localDocumentId, '');
    }
  },

  async deleteDocument(
    userId: string,
    localId?: string,
    cloudId?: string
  ): Promise<void> {
    if (cloudId) {
      await DocumentService.deleteDocument(userId, cloudId);
    }
    if (localId) {
      await LocalDocumentService.deleteDocument(localId);
    }
  },

  async getStorageState(
    userId: string,
    localId?: string,
    cloudId?: string
  ): Promise<StorageState> {
    const [localExists, cloudExists] = await Promise.all([
      localId ? LocalDocumentService.getDocument(localId).then(d => !!d) : Promise.resolve(false),
      cloudId ? DocumentService.getDocument(userId, cloudId).then(d => !!d) : Promise.resolve(false),
    ]);
    return { local: localExists, cloud: cloudExists };
  },
};

async function saveVersionToLocal(
  db: Awaited<ReturnType<typeof getLocalDb>>,
  documentId: string,
  data: SaveDocumentData,
  existing: LocalDocument,
  newVersion: number,
  prevContent: string,
  now: number
): Promise<void> {
  const tx = db.transaction(['documents', 'versions'], 'readwrite');
  const docStore = tx.objectStore('documents');
  const verStore = tx.objectStore('versions');

  const diff = computeWordDelta(prevContent, data.content);
  const verId = `ver_${randomUUID()}`;
  const totalWords = data.documentWordCount ?? data.wordCount;

  try {
    await verStore.put({
      id: verId,
      documentId,
      guestId: existing.guestId,
      version: newVersion,
      content: data.content,
      wordCount: data.wordCount,
      wordsAdded: diff.wordsAdded,
      charsAdded: diff.charsAdded,
      duration: data.duration,
      wpm: data.wpm,
      goalWords: data.goalWords,
      goalTime: data.goalTime,
      goalReached: data.goalReached ?? false,
      savedAt: now,
      sessionStartedAt: data.sessionStartedAt.getTime(),
      mood: data.mood,
    });

    await docStore.put({
      ...existing,
      totalWords,
      totalDuration: data.duration,
      currentVersion: newVersion,
      sessionsCount: (existing.sessionsCount || 0) + 1,
      lastSessionAt: now,
      mood: data.mood,
    });

    await tx.done;
  } catch (localErr) {
    if (localErr instanceof DOMException && localErr.name === 'QuotaExceededError') {
      reportError(localErr, { action: 'saveVersionToLocal', documentId, quotaExceeded: true }, 'warning');
    } else {
      reportError(localErr, { action: 'saveVersionToLocal_localSave', documentId });
      throw localErr;
    }
  }
}

async function updateLocalProfile(
  guestId: string,
  oldWords: number,
  newWords: number,
  oldDuration: number,
  newDuration: number,
  now: number
): Promise<void> {
  try {
    const profileDb = await getLocalDb();
    const profileTx = profileDb.transaction(['profile'], 'readwrite');
    const profStore = profileTx.objectStore('profile');
    const profile = await profStore.get(guestId);
    if (profile) {
      await profStore.put({
        ...profile,
        totalWords: profile.totalWords - oldWords + newWords,
        totalDuration: profile.totalDuration - oldDuration + newDuration,
        sessionsCount: profile.sessionsCount + 1,
        lastSessionAt: now,
      });
    }
    await profileTx.done;

    if (!profile) {
      await LocalDocumentService._updateProfile(guestId);
    }
  } catch (profileErr) {
    reportError(profileErr, { action: 'updateLocalProfile', guestId });
    try {
      await LocalDocumentService._updateProfile(guestId);
    } catch (fallbackErr) {
      reportError(fallbackErr, { action: 'updateLocalProfile_fallback', guestId });
    }
  }
}

async function syncVersionToCloud(
  userId: string,
  documentId: string,
  linkedCloudId: string,
  data: SaveDocumentData,
  newVersion: number,
  prevContent: string
): Promise<void> {
  if (!isFirestoreConnected) {
    const syncDb = await getLocalDb();
    await syncDb.put('syncQueue', {
      id: `sync_${documentId}_${Date.now()}`,
      documentId,
      type: 'document' as const,
      createdAt: Date.now(),
    });
    return;
  }
  try {
    const cloudDoc = await DocumentService.getDocument(userId, linkedCloudId);
    if (!cloudDoc) {
      const syncDb = await getLocalDb();
      await syncDb.put('syncQueue', {
        id: `sync_${documentId}_${Date.now()}`,
        documentId,
        type: 'document' as const,
        createdAt: Date.now(),
      });
    } else {
      const startedAt = data.sessionStartedAt;
      if (isNaN(startedAt.getTime())) {
        throw new Error('Invalid sessionStartedAt');
      }
      const versionPayload = await maybeEncrypt({
        content: data.content,
        previousContent: prevContent,
        wordCount: data.wordCount,
        duration: data.duration,
        wpm: data.wpm,
        versionNumber: newVersion,
        goalWords: data.goalWords,
        goalTime: data.goalTime,
        goalReached: data.goalReached,
        sessionStartedAt: startedAt,
        mood: data.mood,
      } satisfies VersionEncryptPayload, ['content', 'previousContent'], [], userId);
      await VersionService.addVersion(userId, linkedCloudId, {
        content: versionPayload.content as string,
        previousContent: versionPayload.previousContent as string,
        wordCount: data.wordCount,
        duration: data.duration,
        wpm: data.wpm,
        versionNumber: newVersion,
        goalWords: data.goalWords,
        goalTime: data.goalTime,
        goalReached: data.goalReached,
        sessionStartedAt: startedAt,
        mood: data.mood,
        _encrypted: versionPayload._encrypted as boolean | undefined,
      });
      await DocumentService.updateDocumentAfterSession(userId, linkedCloudId, {
        totalWords: data.documentWordCount ?? data.wordCount,
        totalDuration: data.duration,
        currentVersion: newVersion,
        mood: data.mood,
      });
    }
  } catch (e) {
    reportError(e, { action: 'syncVersionToCloud', documentId, linkedCloudId });
    try {
      const syncDb = await getLocalDb();
      await syncDb.put('syncQueue', {
        id: `sync_${documentId}_${Date.now()}`,
        documentId,
        type: 'document' as const,
        createdAt: Date.now(),
      });
    } catch (queueErr) {
      reportError(queueErr, { action: 'syncVersionToCloud_queueSync', documentId });
    }
  }
}

async function _doSaveVersion(
  userId: string,
  documentId: string,
  data: SaveDocumentData
): Promise<void> {
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

  await saveVersionToLocal(db, documentId, data, existing, newVersion, prevContent, now);

  await updateLocalProfile(
    existing.guestId,
    existing.totalWords,
    totalWords,
    existing.totalDuration,
    data.duration,
    now
  );

  if (existing.linkedCloudId) {
    await syncVersionToCloud(
      userId,
      documentId,
      existing.linkedCloudId,
      data,
      newVersion,
      prevContent
    );
  }
}
