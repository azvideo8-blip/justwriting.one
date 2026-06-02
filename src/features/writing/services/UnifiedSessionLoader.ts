import { User } from 'firebase/auth';
import { Session, Document } from '../../../types';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { DocumentService } from '../../../core/services/DocumentService';
import { VersionService } from '../../../core/services/VersionService';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { toDate } from '../../../core/utils/dateUtils';
import { maybeDecrypt } from '../../../core/crypto/cryptoHelpers';
import { reportError } from '../../../shared/errors/reportError';
import { getLocalDb } from '../../../core/storage/localDb';
import pLimit from 'p-limit';

interface LoadedSession extends Session {
  _linkedCloudId?: string | undefined;
  _hasCloudCopy?: boolean | undefined;
  _totalWords?: number | undefined;
  _totalDuration?: number | undefined;
  _sessionsCount?: number | undefined;
  _firstSessionAt?: number | undefined;
  _locked?: boolean | undefined;
  _decryptionError?: boolean | undefined;
  _hasPendingSync?: boolean | undefined;
}

interface LoadResult {
  sessions: LoadedSession[];
  cloudLoadFailed: boolean;
}

export async function loadAllSessions(userId: string, user: User | null): Promise<LoadResult> {
  const allSessions: LoadedSession[] = [];
  const seenIds = new Set<string>();
  let cloudLoadFailed = false;

  const pendingDocIds = new Set<string>();
  try {
    const db = await getLocalDb();
    const queue = await db.getAll('syncQueue');
    for (const item of queue) {
      if (item.documentId && !item.id.startsWith('lock_cloud_')) {
        pendingDocIds.add(item.documentId);
      }
    }
  } catch (err) {
    reportError(err, { action: 'loadAllSessions_syncQueue' });
  }

  const idsToQuery = user ? [user.uid, userId] : [userId];

  for (const uid of idsToQuery) {
    const localDocs = await LocalDocumentService.getGuestDocuments(uid);
    const localByCloudId = new Set(localDocs.filter(d => d.linkedCloudId).map(d => d.linkedCloudId!));

    for (const doc of localDocs) {
      if (seenIds.has(doc.id)) continue;
      seenIds.add(doc.id);
      let content = '';
      let _contentError = false;
      try { content = await LocalVersionService.getLatestContent(doc.id); } catch (contentErr) { reportError(contentErr, { action: 'loadAllSessions_localContent', documentId: doc.id }); _contentError = true; }
      const createdAt = toDate(doc.lastSessionAt) ?? new Date();
      allSessions.push({
        id: doc.id,
        userId: doc.guestId,
        content,
        duration: doc.totalDuration,
        wordCount: doc.totalWords,
        charCount: 0,
        wpm: 0,
        title: doc.title,
        tags: doc.tags,
        labelId: doc.labelId ?? undefined,
        createdAt,
        sessionStartTime: doc.lastSessionAt,
        _isLocal: true,
        _linkedCloudId: doc.linkedCloudId || undefined,
        _hasCloudCopy: !!doc.linkedCloudId,
        _hasPendingSync: pendingDocIds.has(doc.id),
        _totalWords: doc.totalWords,
        _totalDuration: doc.totalDuration,
        _sessionsCount: doc.sessionsCount,
        _firstSessionAt: doc.firstSessionAt,
        ...( _contentError ? { _contentError: true } : {}),
      });
    }

    if (user && uid === user.uid) {
      let cloudDocs: Document[] = [];
      try {
        cloudDocs = await DocumentService.getUserDocuments(uid);
      } catch (e) {
        cloudLoadFailed = true;
        reportError(e, { action: 'loadAllSessions_cloudDocs', uid });
      }

      const limiter = pLimit(5);
      const cloudSessionsPromises = cloudDocs
        .filter(cloudDoc => !localByCloudId.has(cloudDoc.id) && !seenIds.has(cloudDoc.id))
        .map(cloudDoc => limiter(async () => {
          seenIds.add(cloudDoc.id);
          const created = toDate(cloudDoc.lastSessionAt) ?? new Date();
          let cloudContent = '';
          let cloudContentError = false;
          let cloudLocked = false;
          let cloudDecryptError = false;
          try {
            const latest = await VersionService.getLatestVersion(uid, cloudDoc.id);
            if (latest) {
              try {
                const latestRecord: Record<string, unknown> = { ...latest };
                const decrypted = await maybeDecrypt(latestRecord, ['content'], []);
                cloudContent = typeof decrypted.content === 'string' ? decrypted.content : '';
                if (decrypted._decryptionError) cloudDecryptError = true;
              } catch (decErr) {
                if (decErr instanceof Error && decErr.message.startsWith('LOCKED')) {
                  cloudLocked = true;
                  cloudContent = latest.content ?? '';
                } else {
                  throw decErr;
                }
              }
            }
          } catch (contentErr) {
            reportError(contentErr, { action: 'loadAllSessions_cloudContent', documentId: cloudDoc.id });
            cloudContentError = true;
          }
          return {
            id: cloudDoc.id,
            userId: uid,
            content: cloudContent,
            duration: cloudDoc.totalDuration,
            wordCount: cloudDoc.totalWords,
            charCount: 0,
            wpm: 0,
            title: cloudDoc.title,
            tags: cloudDoc.tags,
            labelId: cloudDoc.labelId ?? undefined,
            createdAt: created,
            sessionStartTime: created.getTime(),
            _isLocal: false,
            _linkedCloudId: cloudDoc.id,
            _hasCloudCopy: true,
            _totalWords: cloudDoc.totalWords,
            _totalDuration: cloudDoc.totalDuration,
            _sessionsCount: cloudDoc.sessionsCount,
            _firstSessionAt: toDate(cloudDoc.firstSessionAt)?.getTime(),
            ...(cloudContentError ? { _contentError: true } : {}),
            ...(cloudLocked ? { _locked: true } : {}),
            ...(cloudDecryptError ? { _decryptionError: true } : {}),
          };
        }));

      const cloudSessions = await Promise.all(cloudSessionsPromises);
      allSessions.push(...cloudSessions);
    }
  }


  allSessions.sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));

  return { sessions: allSessions, cloudLoadFailed };
}
