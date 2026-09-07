import type { AppUser } from '../auth/types';
import { Session, Document } from '../../types';
import { LocalDocumentService } from './LocalDocumentService';
import { DocumentService } from './DocumentService';
import { LocalVersionService } from './LocalVersionService';
import { VersionService } from './VersionService';
import { maybeDecrypt, DecryptionError } from '../crypto/cryptoHelpers';
import { toDate } from '../utils/dateUtils';
import { reportError } from '../../shared/errors/reportError';
import { getLocalDb } from '../storage/localDb';
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

export async function loadAllSessions(
  userId: string,
  user: AppUser | null,
  opts?: { withContent?: boolean },
): Promise<LoadResult> {
  // AUD-24: тексты нужны архиву и экспорту, а статистике — счётчики, которые
  // и так лежат в записи документа. Раньше открытие профиля расшифровывало
  // весь архив, чтобы нарисовать число слов, уже посчитанное при сохранении.
  const withContent = opts?.withContent ?? false;
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
    const localDocs = await LocalDocumentService.getDocumentsByOwner(uid);
    const localByCloudId = new Set(localDocs.filter(d => d.linkedCloudId).map(d => d.linkedCloudId!));
    // Второй ключ дедупликации — канонический uuid. В облаке id документа И
    // ЕСТЬ этот uuid (см. карту полей: id ↔ uuid), а linkedCloudId проставляется
    // только после того, как выгрузка дойдёт до конца.
    //
    // Импорт заметки запускает выгрузку не дожидаясь её (иначе импорт вис бы на
    // сети) и тут же обновляет список. В этот момент облачная строка уже есть, а
    // ссылки на неё локально ещё нет — и заметка показывалась ДВАЖДЫ: один раз
    // локальная с текстом, второй раз облачная с пустым content, потому что
    // версии ещё не доехали. Человеку приходилось удалять пустую копию руками.
    const localUuids = new Set(localDocs.map(d => d.uuid).filter(Boolean));

    // E-7: Batch-read sittings for all local docs in one cursor scan
    let sittingsMap: Map<string, import('../../types').SessionSitting[]> | undefined;
    try {
      sittingsMap = await LocalVersionService.getAllDocumentSittings();
    } catch (err) {
      reportError(err, { action: 'loadAllSessions_getAllDocumentSittings' });
    }

    for (const doc of localDocs) {
      if (seenIds.has(doc.id)) continue;
      seenIds.add(doc.id);
      let content = '';
      let _contentError = false;
      let _contentNotLoaded = false;
      let sessionWordsAdded: number | undefined;
      let sittings: import('../../types').SessionSitting[] | undefined;
      const docSittings = sittingsMap?.get(doc.id);
      if (docSittings && docSittings.length > 0) {
        sittings = docSittings;
        sessionWordsAdded = docSittings[docSittings.length - 1]?.wordsAdded;
      } else if (!sittingsMap) {
        try {
          const fallbackDocSittings = await LocalVersionService.getDocumentSittings(doc.id);
          if (fallbackDocSittings.length > 0) {
            sittings = fallbackDocSittings;
            sessionWordsAdded = fallbackDocSittings[fallbackDocSittings.length - 1]?.wordsAdded;
          } else {
            const latestMeta = await LocalVersionService.getLatestVersionMeta(doc.id);
            sessionWordsAdded = latestMeta?.wordsAdded;
          }
        } catch {
          sittings = undefined;
          sessionWordsAdded = (await LocalVersionService.getLatestVersionMeta(doc.id).catch(() => null))?.wordsAdded;
        }
      }
      try {
        if (withContent) {
          content = await LocalVersionService.getLatestContent(doc.id);
        } else {
          // «Не читали» — не «не смогли прочитать»: _contentError означает
          // потерю (AUD-5), поэтому при пропуске ставим только флаг
          // незагруженности, а потребители текста догружают его сами.
          _contentNotLoaded = true;
        }
      } catch (contentErr) { reportError(contentErr, { action: 'loadAllSessions_localContent', documentId: doc.id }); _contentError = true; }
      const createdAt = toDate(doc.lastSessionAt) ?? new Date();
      allSessions.push({
        id: doc.id,
        userId: doc.guestId,
        content,
        duration: doc.totalDuration,
        wordCount: doc.totalWords,
        sessionWordsAdded,
        sittings,
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
        excludedFromAI: doc.excludedFromAI ?? false,
        ...( _contentError ? { _contentError: true } : {}),
        ...(_contentNotLoaded ? { _contentNotLoaded: true } : {}),
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
        .filter(cloudDoc => !localByCloudId.has(cloudDoc.id)
          && !localUuids.has(cloudDoc.id)
          && !seenIds.has(cloudDoc.id))
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
            excludedFromAI: cloudDoc.excludedFromAI ?? false,
            ...(cloudDoc._locked ? { _locked: true } : {}),
            ...(cloudDoc._decryptionError ? { _decryptionError: true } : {}),
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
    if (latest === 'PARSE_FAILED') {
      // Версия есть, но запись не прошла валидацию. Это не «заметка пуста»:
      // пустой текст без флага уходил бы в экспорт как успешный файл.
      return { content: '', _contentError: true, _contentNotLoaded: false };
    }
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
    // Локальная заметка гидратируется из локальных версий: раньше список всегда
    // нёс её текст, но с AUD-24 (withContent по запросу) текст может быть
    // пропущен — а облачный путь ниже искал бы по локальному id.
    if (session._isLocal) {
      try {
        const content = await LocalVersionService.getLatestContent(session.id);
        return { ...session, content, _contentNotLoaded: false };
      } catch (e) {
        reportError(e, { action: 'hydrateSessionContent_local', documentId: session.id });
        return { ...session, content: '', _contentError: true as const, _contentNotLoaded: false as const };
      }
    }
    const flags = await loadSessionContent(userId, session.id);
    return { ...session, ...flags };
  })));
}
