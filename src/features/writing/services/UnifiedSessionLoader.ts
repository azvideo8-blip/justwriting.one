import { User } from 'firebase/auth';
import { Session, Document } from '../../../types';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { DocumentService } from '../../../core/services/DocumentService';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { VersionService } from '../../../core/services/VersionService';
import { maybeDecrypt, DecryptionError } from '../../../core/crypto/cryptoHelpers';
import { toDate } from '../../../core/utils/dateUtils';
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
  _contentError?: boolean | undefined;
  // The list view deliberately does not fetch version text for cloud-only notes
  // (one read per note on every archive load). "Not fetched yet" is NOT "empty":
  // anything that consumes `content` — preview, export — must load it first or
  // treat the note as unavailable. Writing it out as empty is data loss on a
  // note that is perfectly intact in the cloud.
  _contentNotLoaded?: boolean | undefined;
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

      const cloudSessions = cloudDocs
        .filter(cloudDoc => !localByCloudId.has(cloudDoc.id) && !seenIds.has(cloudDoc.id))
        .map(cloudDoc => {
          seenIds.add(cloudDoc.id);
          const created = toDate(cloudDoc.lastSessionAt) ?? new Date();
          return {
            id: cloudDoc.id,
            userId: uid,
            content: '',
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
            _contentNotLoaded: true,
          };
        });

      allSessions.push(...cloudSessions);
    }
  }


  allSessions.sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));

  return { sessions: allSessions, cloudLoadFailed };
}

type ContentFlags = Pick<LoadedSession, 'content' | '_locked' | '_decryptionError' | '_contentError' | '_contentNotLoaded'>;

/**
 * Fetches one cloud note's latest text. This is the work `loadAllSessions`
 * skips: it costs a read per note, so the list view does without it and pays
 * only for the notes actually opened.
 *
 * Returns the same flags the list used to carry, so callers keep telling
 * "locked" and "unreadable" apart from "empty".
 */
export async function loadSessionContent(userId: string, cloudDocumentId: string): Promise<ContentFlags> {
  try {
    const latest = await VersionService.getLatestVersion(userId, cloudDocumentId);
    if (!latest) return { content: '', _contentNotLoaded: false };
    try {
      const decrypted = await maybeDecrypt({ ...latest } as Record<string, unknown>, ['content'], []);
      const content = typeof decrypted.content === 'string' ? decrypted.content : '';
      return { content, _contentNotLoaded: false };
    } catch (decErr) {
      if (decErr instanceof DecryptionError) return { content: '', _decryptionError: true, _contentNotLoaded: false };
      if (decErr instanceof Error && decErr.message.startsWith('LOCKED')) return { content: '', _locked: true, _contentNotLoaded: false };
      throw decErr;
    }
  } catch (e) {
    reportError(e, { action: 'loadSessionContent', documentId: cloudDocumentId });
    return { content: '', _contentError: true, _contentNotLoaded: false };
  }
}

/**
 * Loads the text the list view left out, for every session that still needs it.
 *
 * Export MUST run this first. Both export paths decide what to skip from
 * `_locked` / `_decryptionError` / `_contentError`, and a note whose text was
 * never fetched carries none of them — so it would be written out as an empty
 * file and counted as successfully exported.
 */
export async function hydrateSessionContent<T extends LoadedSession>(sessions: T[], userId: string): Promise<T[]> {
  const limiter = pLimit(5);
  return Promise.all(sessions.map(session => limiter(async () => {
    if (!session._contentNotLoaded) return session;
    const flags = await loadSessionContent(userId, session.id);
    return { ...session, ...flags };
  })));
}
