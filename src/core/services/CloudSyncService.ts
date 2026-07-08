import { DocumentService } from './DocumentService';
import { VersionService } from './VersionService';
import { LocalStorageService } from './LocalStorageService';
import { LocalVersionService } from './LocalVersionService';
import { getLocalDb } from '../storage/localDb';
import { toDate } from '../utils/dateUtils';
import { maybeEncrypt, maybeDecrypt, type VersionEncryptPayload } from '../crypto/cryptoHelpers';
import { reportError } from '../../shared/errors/reportError';
import { withTimeout as withTimeoutBase } from '../../shared/utils/withTimeout';
import { isFirestoreConnected } from '../firebase/firestore';
import { getClient } from '../firebase/firestoreClient';
import pLimit from 'p-limit';
import { SaveDocumentData } from './storageTypes';
import { ConflictResolver } from './ConflictResolver';

const CLOUD_SYNC_TIMEOUT = 30_000;
const LOCK_TTL_MS = 30_000;
// Must match AIProfileService's PORTRAIT_LS_KEY. Duplicated here (rather than
// imported) because core must not import from features/ (ARCHITECTURE.md) —
// AIProfileService.syncPortraitToCloud delegates to this method instead.
const PORTRAIT_LS_KEY = 'ai_user_portrait';

function withTimeout<T>(promise: Promise<T>, ms: number = CLOUD_SYNC_TIMEOUT): Promise<T> {
  return withTimeoutBase(promise, ms, 'Sync timeout');
}

export const CloudSyncService = {
  async addLocalCopy(userId: string, cloudDocumentId: string): Promise<string> {
    const allLocal = await LocalStorageService.getGuestDocuments(userId);
    const existing = allLocal.find(d => d.linkedCloudId === cloudDocumentId);
    if (existing) return existing.id;

    const cloudDoc = await DocumentService.getDocument(userId, cloudDocumentId);
    if (!cloudDoc) throw new Error('Cloud document not found');

    const versions = await VersionService.getVersions(userId, cloudDocumentId);
    const firstSessionMs = toDate(cloudDoc.firstSessionAt)?.getTime() ?? undefined;
    const lastSessionMs = toDate(cloudDoc.lastSessionAt)?.getTime() ?? undefined;
    const localId = await LocalStorageService.createDocument(userId, {
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

        const verRecord: Record<string, unknown> = { ...ver };
        let verContent = '';
        try {
          const decryptedVer = await maybeDecrypt(verRecord, ['content'], []);
          verContent = (typeof decryptedVer.content === 'string' ? decryptedVer.content : '') || ver.content;
        } catch (decErr) {
          if (decErr instanceof Error && decErr.message.startsWith('LOCKED')) throw decErr;
          // Skip corrupted version but continue importing others
          verContent = ver.content ?? '';
        }

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
          savedAt: ver.savedAt ? toDate(ver.savedAt) ?? undefined : undefined,
        });
        prevContent = verContent;
      }

      await LocalStorageService.updateDocument(localId, {
        totalWords: cloudDoc.totalWords,
        totalDuration: cloudDoc.totalDuration,
        currentVersion: cloudDoc.currentVersion,
        sessionsCount: cloudDoc.sessionsCount ?? 1,
      });

      await LocalStorageService.updateLinkedCloudId(localId, cloudDocumentId);
    } catch (e) {
      reportError(e, { action: 'addLocalCopy', cloudDocumentId });
      try { await LocalStorageService.deleteDocument(localId); } catch (cleanupErr) {
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
      const localDoc = await LocalStorageService.getDocument(localDocumentId);
      if (!localDoc) throw new Error('Local document not found');

      if (localDoc.linkedCloudId) {
        const existingDoc = await withTimeout(DocumentService.getDocument(userId, localDoc.linkedCloudId));
        if (existingDoc) {
          // Already linked: push any LOCAL versions missing from the cloud and
          // refresh metadata. Previously this early-returned, so edits made after
          // the first sync never reached the cloud (doc stayed "Unsynced Edits").
          const cloudId = localDoc.linkedCloudId;
          const [localVersions, cloudVersions] = await Promise.all([
            LocalVersionService.getVersions(localDocumentId),
            withTimeout(VersionService.getVersions(userId, cloudId)),
          ]);
          const cloudNums = new Set(cloudVersions.map(v => v.version));
          const missing = localVersions.filter(v => !cloudNums.has(v.version));
          const limiter = pLimit(3);
          await Promise.all(missing.map((ver) => limiter(async () => {
            const idx = localVersions.findIndex(v => v.id === ver.id);
            const prevContent = idx <= 0 ? '' : (localVersions[idx - 1]?.content ?? '');
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
            const content = typeof versionPayload.content === 'string' ? versionPayload.content : '';
            const previousContent = typeof versionPayload.previousContent === 'string' ? versionPayload.previousContent : '';
            const _encrypted = typeof versionPayload._encrypted === 'boolean' ? versionPayload._encrypted : undefined;
            await withTimeout(VersionService.addVersion(userId, cloudId, {
              content,
              previousContent,
              wordCount: ver.wordCount,
              duration: ver.duration,
              wpm: ver.wpm,
              versionNumber: ver.version,
              goalWords: ver.goalWords,
              goalTime: ver.goalTime,
              goalReached: ver.goalReached,
              sessionStartedAt: startedAt,
              savedAt: ver.savedAt ? new Date(ver.savedAt) : undefined,
              _encrypted,
            }));
          })));
          await withTimeout(DocumentService.updateDocumentAfterSession(userId, cloudId, {
            totalWords: localDoc.totalWords,
            totalDuration: localDoc.totalDuration,
            currentVersion: localDoc.currentVersion,
            sessionsCount: localDoc.sessionsCount,
            lastSessionAt: localDoc.lastSessionAt ? new Date(localDoc.lastSessionAt) : undefined,
            mood: localDoc.mood,
          }));
          return cloudId;
        }
        await LocalStorageService.updateLinkedCloudId(localDocumentId, '');
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

        const limiter = pLimit(3);
        await Promise.all(versions.map((ver, i) => limiter(async () => {
          const prevContent = i === 0 ? '' : (versions[i - 1]?.content ?? '');
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

          const content = typeof versionPayload.content === 'string' ? versionPayload.content : '';
          const previousContent = typeof versionPayload.previousContent === 'string' ? versionPayload.previousContent : '';
          const _encrypted = typeof versionPayload._encrypted === 'boolean' ? versionPayload._encrypted : undefined;
          await withTimeout(VersionService.addVersion(userId, cloudId!, {
            content,
            previousContent,
            wordCount: ver.wordCount,
            duration: ver.duration,
            wpm: ver.wpm,
            versionNumber: ver.version,
            goalWords: ver.goalWords,
            goalTime: ver.goalTime,
            goalReached: ver.goalReached,
            sessionStartedAt: startedAt,
            savedAt: ver.savedAt ? new Date(ver.savedAt) : undefined,
            _encrypted,
          }));
        })));

        await withTimeout(DocumentService.updateDocumentAfterSession(userId, cloudId, {
          totalWords: localDoc.totalWords,
          totalDuration: localDoc.totalDuration,
          currentVersion: localDoc.currentVersion,
          sessionsCount: localDoc.sessionsCount,
          lastSessionAt: localDoc.lastSessionAt ? new Date(localDoc.lastSessionAt) : undefined,
          mood: localDoc.mood,
        }));
      } catch (e) {
        if (cloudId) {
          try { await DocumentService.deleteDocument(userId, cloudId); } catch (cleanupErr) { reportError(cleanupErr, { action: 'addCloudCopy_cleanup', cloudId }); }
        }
        throw e;
      }

      if (!cloudId) throw new Error('Failed to create cloud document');
      await LocalStorageService.updateLinkedCloudId(localDocumentId, cloudId);
      await LocalStorageService.migrateDocumentOwner(localDocumentId, userId);
      return cloudId;
    } finally {
      try {
        const cleanupDb = await getLocalDb();
        await cleanupDb.delete('syncQueue', lockKey);
      } catch (cleanupErr) { reportError(cleanupErr, { action: 'addCloudCopy_lockCleanup', lockKey }); }
    }
  },

  async removeCloudCopy(userId: string, cloudDocumentId: string, localDocumentId?: string): Promise<void> {
    await DocumentService.deleteDocument(userId, cloudDocumentId);
    if (localDocumentId) {
      await LocalStorageService.updateLinkedCloudId(localDocumentId, '');
    }
  },

  async getDocument(userId: string, cloudId: string) {
    return DocumentService.getDocument(userId, cloudId);
  },

  async syncVersionToCloud(
    userId: string,
    documentId: string,
    linkedCloudId: string,
    data: SaveDocumentData,
    newVersion: number,
    prevContent: string
  ): Promise<{ forked: boolean }> {
    if (!isFirestoreConnected) {
      const syncDb = await getLocalDb();
      await syncDb.put('syncQueue', {
        id: `sync_${documentId}`,
        documentId,
        type: 'document' as const,
        createdAt: Date.now(),
      });
      return { forked: false };
    }
    try {
      const cloudDoc = await DocumentService.getDocument(userId, linkedCloudId);
      if (!cloudDoc) {
        const syncDb = await getLocalDb();
        await syncDb.put('syncQueue', {
          id: `sync_${documentId}`,
          documentId,
          type: 'document' as const,
          createdAt: Date.now(),
        });
      } else if (cloudDoc.currentVersion >= newVersion) {
        const localDoc = await LocalStorageService.getDocument(documentId);
        const result = await ConflictResolver.resolveConflict(
          userId,
          documentId,
          linkedCloudId,
          data,
          newVersion,
          cloudDoc,
          localDoc?.firstSessionAt
        );
        return result;
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
        const content = typeof versionPayload.content === 'string' ? versionPayload.content : '';
        const previousContent = typeof versionPayload.previousContent === 'string' ? versionPayload.previousContent : '';
        const _encrypted = typeof versionPayload._encrypted === 'boolean' ? versionPayload._encrypted : undefined;
        await VersionService.addVersion(userId, linkedCloudId, {
          content,
          previousContent,
          wordCount: data.wordCount,
          duration: data.duration,
          wpm: data.wpm,
          versionNumber: newVersion,
          goalWords: data.goalWords,
          goalTime: data.goalTime,
          goalReached: data.goalReached,
          sessionStartedAt: startedAt,
          mood: data.mood,
          _encrypted,
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
          id: `sync_${documentId}`,
          documentId,
          type: 'document' as const,
          createdAt: Date.now(),
        });
      } catch (queueErr) {
        reportError(queueErr, { action: 'syncVersionToCloud_queueSync', documentId });
      }
    }
    return { forked: false };
  },

  /** Pushes the locally-cached AI profile portrait to Firestore. Lives here
   *  (not in features/ai) so the sync-queue drain (core/services/SyncService,
   *  which must not import from features/) can call it directly for queued
   *  'portrait' tasks. AIProfileService.syncPortraitToCloud delegates here. */
  async syncPortraitToCloud(userId: string): Promise<void> {
    const portraitMarkdown = localStorage.getItem(PORTRAIT_LS_KEY);
    if (!portraitMarkdown) return;

    const encrypted = await maybeEncrypt(
      { aiPortrait: portraitMarkdown },
      ['aiPortrait'],
      [],
      userId,
    );
    const { db, mod } = await getClient();
    await mod.setDoc(mod.doc(db, 'users', userId), encrypted, { merge: true });
  },
};
