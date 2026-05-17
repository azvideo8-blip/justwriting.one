import { User } from 'firebase/auth';
import { Session, Document } from '../../../types';
import { LocalDocumentService } from './LocalDocumentService';
import { DocumentService } from './DocumentService';
import { VersionService } from './VersionService';
import { SessionService } from './SessionService';
import { LocalVersionService } from './LocalVersionService';
import { toDate } from '../../../core/utils/dateUtils';

interface LoadedSession extends Session {
  _linkedCloudId?: string;
  _hasCloudCopy?: boolean;
  _isLegacy?: boolean;
  _totalWords?: number;
  _totalDuration?: number;
  _sessionsCount?: number;
}

interface LoadResult {
  sessions: LoadedSession[];
  cloudLoadFailed: boolean;
}

export async function loadAllSessions(userId: string, user: User | null): Promise<LoadResult> {
  const allSessions: LoadedSession[] = [];
  const seenIds = new Set<string>();
  let cloudLoadFailed = false;

  const idsToQuery = user ? [user.uid, userId] : [userId];

  for (const uid of idsToQuery) {
    const localDocs = await LocalDocumentService.getGuestDocuments(uid);
    const localByCloudId = new Set(localDocs.filter(d => d.linkedCloudId).map(d => d.linkedCloudId!));

    for (const doc of localDocs) {
      if (seenIds.has(doc.id)) continue;
      seenIds.add(doc.id);
      let content = '';
      let _contentError = false;
      try { content = await LocalVersionService.getLatestContent(doc.id); } catch { _contentError = true; }
      const createdAt = toDate(doc.firstSessionAt) ?? new Date();
      allSessions.push({
        id: doc.id,
        userId: doc.guestId,
        authorName: '',
        authorPhoto: '',
        content,
        duration: doc.totalDuration,
        wordCount: doc.totalWords,
        charCount: 0,
        wpm: 0,
        title: doc.title,
        tags: doc.tags,
        labelId: doc.labelId ?? undefined,
        createdAt,
        sessionStartTime: doc.firstSessionAt,
        _isLocal: true,
        _linkedCloudId: doc.linkedCloudId || undefined,
        _hasCloudCopy: !!doc.linkedCloudId,
        _totalWords: doc.totalWords,
        _totalDuration: doc.totalDuration,
        _sessionsCount: doc.sessionsCount,
        ...( _contentError ? { _contentError: true } : {}),
      });
    }

    if (user && uid === user.uid) {
      let cloudDocs: Document[] = [];
      try {
        cloudDocs = await DocumentService.getUserDocuments(uid);
      } catch (e) {
        cloudLoadFailed = true;
        console.error(`Failed to fetch cloud docs for uid=${uid}:`, e);
      }

      for (const cloudDoc of cloudDocs) {
        if (localByCloudId.has(cloudDoc.id) || seenIds.has(cloudDoc.id)) continue;
        seenIds.add(cloudDoc.id);

        const created = toDate(cloudDoc.firstSessionAt) ?? new Date();
        let cloudContent = '';
        let cloudContentError = false;
        try { cloudContent = await VersionService.getLatestContent(user.uid, cloudDoc.id); } catch { cloudContentError = true; }
        allSessions.push({
          id: cloudDoc.id,
          userId: user.uid,
          authorName: '',
          authorPhoto: '',
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
          ...(cloudContentError ? { _contentError: true } : {}),
        });
      }
    }
  }

  if (user) {
    try {
      const { sessions: legacySessions } = await SessionService.getAllSessions(user.uid, 500);
      for (const s of legacySessions) {
        if (seenIds.has(s.id)) continue;
        seenIds.add(s.id);
        allSessions.push({ ...s, _isLocal: false, _isLegacy: true });
      }
    } catch (e) {
      console.error('Failed to fetch legacy sessions:', e);
    }
  }

  allSessions.sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));

  return { sessions: allSessions, cloudLoadFailed };
}
