import type { AppUser } from '../../../core/auth/types';
import { DocumentService } from '../../../core/services/DocumentService';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { StorageService } from '../../../core/services/StorageService';
import { SyncService } from '../../../core/services/SyncService';
import { CloudSyncService } from '../../../core/services/CloudSyncService';
import { ArchiveSession } from '../types';
import { reportError } from '../../../shared/errors/reportError';
import { emitDomainEvent } from '../../../core/events/domainEvents';
import { useActivityLogStore } from '../../../shared/activity/useActivityLogStore';

type ArchiveField = 'tags' | 'title' | 'date' | 'labelId';
type ArchiveFieldValue = string[] | string | Date | undefined;

// R3-1: правка метаданных не дошла до облака. Одной постановки в очередь мало:
// дренаж по связанной заметке шлёт только счётчики, и правка терялась с
// пометкой «сохранено». Флаг говорит дренажу дослать метаданные целиком.
// BR-9 (класс RA1-1): владелец нужен обоим вызовам — без него база резолвится
// через `getCurrentUser()`, а в окне восстановления сессии это гостевая база:
// флаг и задача оставались в `justwriting-local`, заметка — в базе аккаунта.
async function queueMetadataRetry(localId: string, userId: string): Promise<void> {
  try {
    await LocalDocumentService.setMetadataDirty(localId, true, userId);
  } catch (e) {
    reportError(e, { action: 'queueMetadataRetry_flag', documentId: localId });
  }
  await SyncService.addToQueue(localId, userId);
}

export async function toggleAIExclusion(
  session: ArchiveSession,
  excluded: boolean,
  user: AppUser | null,
  userId: string
): Promise<{ success: boolean; cloudSyncFailed?: boolean }> {
  if (session._locked) throw new Error('LOCKED: cannot modify locked session');
  if (session._decryptionError) throw new Error('DECRYPTION_ERROR: cannot modify unreadable session');
  let cloudSyncFailed = false;

  if (session._isLocal) {
    await LocalDocumentService.updateExcludedFromAI(session.id, excluded, userId);
    emitDomainEvent({ type: 'note.excludedFromAI', documentId: session.id, excluded });
    if (session._linkedCloudId && user) {
      await DocumentService.updateExcludedFromAI(user.uid, session._linkedCloudId, excluded).catch(e => {
        cloudSyncFailed = true;
        reportError(e, { action: 'toggleAIExclusion_cloud', documentId: session._linkedCloudId });
        void queueMetadataRetry(session.id, userId);
      });
    }
    return cloudSyncFailed ? { success: true, cloudSyncFailed } : { success: true };
  }

  // Cloud-only document
  if (user) {
    try {
      await DocumentService.updateExcludedFromAI(user.uid, session.id, excluded);
      emitDomainEvent({ type: 'note.excludedFromAI', documentId: session.id, excluded });
    } catch (e) {
      reportError(e, { action: 'toggleAIExclusion_cloudOnly', documentId: session.id });
      cloudSyncFailed = true;
      try {
        const localId = await CloudSyncService.addLocalCopy(user.uid, session.id);
        await LocalDocumentService.updateExcludedFromAI(localId, excluded, userId);
        emitDomainEvent({ type: 'note.excludedFromAI', documentId: localId, excluded });
        void queueMetadataRetry(localId, userId);
      } catch (localErr) {
        reportError(localErr, { action: 'toggleAIExclusion_localFallback', documentId: session.id });
        throw localErr;
      }
    }
  }
  return cloudSyncFailed ? { success: true, cloudSyncFailed } : { success: true };
}

export async function updateArchiveField(
  session: ArchiveSession,
  field: ArchiveField,
  value: ArchiveFieldValue,
  user: AppUser | null,
  userId: string
): Promise<{ success: boolean; cloudSyncFailed?: boolean }> {
  if (session._locked) throw new Error('LOCKED: cannot modify locked session');
  if (session._decryptionError) throw new Error('DECRYPTION_ERROR: cannot modify unreadable session');
  let cloudSyncFailed = false;

  if (session._isLocal) {
    if (field === 'tags') {
      const tags = Array.isArray(value) ? value : [];
      await LocalDocumentService.updateTags(session.id, tags, userId);
      if (session._linkedCloudId && user) {
        await DocumentService.updateTags(user.uid, session._linkedCloudId, tags).catch(e => {
          cloudSyncFailed = true;
          reportError(e, { action: 'updateArchiveField_tags', documentId: session._linkedCloudId });
          // Queue the LOCAL id — the drain (_drainPendingQueue -> addCloudCopy)
          // looks up a local IndexedDB document by this id, not a cloud one.
          void queueMetadataRetry(session.id, userId);
        });
      }
    } else if (field === 'title') {
      const title = typeof value === 'string' ? value : '';
      await LocalDocumentService.updateTitle(session.id, title, userId);
      if (session._linkedCloudId && user) {
        await DocumentService.updateTitle(user.uid, session._linkedCloudId, title).catch(e => {
          cloudSyncFailed = true;
          reportError(e, { action: 'updateArchiveField_title', documentId: session._linkedCloudId });
          // Queue the LOCAL id — the drain (_drainPendingQueue -> addCloudCopy)
          // looks up a local IndexedDB document by this id, not a cloud one.
          void queueMetadataRetry(session.id, userId);
        });
      }
    } else if (field === 'date') {
      if (!(value instanceof Date)) throw new Error('Expected Date for date field');
      const ts = value.getTime();
      await LocalDocumentService.updateDate(session.id, { lastSessionAt: ts }, userId);
      if (session._linkedCloudId && user) {
        await DocumentService.updateDate(user.uid, session._linkedCloudId, { lastSessionAt: value }).catch(e => {
          cloudSyncFailed = true;
          reportError(e, { action: 'updateArchiveField_date', documentId: session._linkedCloudId });
          // Queue the LOCAL id — the drain (_drainPendingQueue -> addCloudCopy)
          // looks up a local IndexedDB document by this id, not a cloud one.
          void queueMetadataRetry(session.id, userId);
        });
      }
    } else if (field === 'labelId') {
      const labelId = typeof value === 'string' || value === undefined ? value : undefined;
      await LocalDocumentService.updateLabelId(session.id, labelId, userId);
      if (session._linkedCloudId && user) {
        await DocumentService.updateLabelId(user.uid, session._linkedCloudId, labelId).catch(e => {
          cloudSyncFailed = true;
          reportError(e, { action: 'updateArchiveField_labelId', documentId: session._linkedCloudId });
          // Queue the LOCAL id — the drain (_drainPendingQueue -> addCloudCopy)
          // looks up a local IndexedDB document by this id, not a cloud one.
          void queueMetadataRetry(session.id, userId);
        });
      }
    }
    return cloudSyncFailed ? { success: true, cloudSyncFailed } : { success: true };
  }

  // Cloud-only: try cloud, fallback to local copy on failure
  if (user) {
    // Validate before try/catch so type errors still propagate
    if (field === 'date' && !(value instanceof Date)) throw new Error('Expected Date for date field');

    try {
      if (field === 'tags') {
        const tags = Array.isArray(value) ? value : [];
        await DocumentService.updateTags(user.uid, session.id, tags);
      } else if (field === 'title') {
        const title = typeof value === 'string' ? value : '';
        await DocumentService.updateTitle(user.uid, session.id, title);
      } else if (field === 'date') {
        if (value instanceof Date) await DocumentService.updateDate(user.uid, session.id, { lastSessionAt: value });
      } else if (field === 'labelId') {
        const labelId = typeof value === 'string' || value === undefined ? value : undefined;
        await DocumentService.updateLabelId(user.uid, session.id, labelId);
      }
    } catch (e) {
      reportError(e, { action: `updateArchiveField_${field}_cloudOnly`, documentId: session.id });
      cloudSyncFailed = true;

      // Create (or reuse) a local shadow copy so the edit persists and can be
      // synced later. addLocalCopy pulls the real content/versions from the
      // cloud (not just metadata) and reuses an existing local copy from a
      // previous failed edit instead of creating a duplicate — reimplementing
      // that here previously left new local docs with 0 versions (looked
      // empty) and queued the CLOUD id instead of the new local id (the drain
      // expects a local id, so the sync would never actually complete).
      try {
        const localId = await CloudSyncService.addLocalCopy(user.uid, session.id);
        await _applyLocalFieldEdit(localId, field, value, userId);
        void queueMetadataRetry(localId, userId);
      } catch (localErr) {
        reportError(localErr, { action: `updateArchiveField_${field}_localFallback`, documentId: session.id });
        // Both cloud AND the local fallback failed — nothing was persisted
        // anywhere. Rethrow so the caller's existing catch shows a real error
        // instead of the optimistic UI update proceeding on a silent lie.
        throw localErr;
      }
    }
  }
  return cloudSyncFailed ? { success: true, cloudSyncFailed } : { success: true };
}

async function _applyLocalFieldEdit(
  localId: string,
  field: ArchiveField,
  value: ArchiveFieldValue,
  ownerId: string
): Promise<void> {
  if (field === 'tags') {
    await LocalDocumentService.updateTags(localId, Array.isArray(value) ? value : [], ownerId);
  } else if (field === 'title') {
    await LocalDocumentService.updateTitle(localId, typeof value === 'string' ? value : '', ownerId);
  } else if (field === 'date') {
    if (value instanceof Date) {
      await LocalDocumentService.updateDate(localId, { lastSessionAt: value.getTime() }, ownerId);
    }
  } else if (field === 'labelId') {
    await LocalDocumentService.updateLabelId(localId, typeof value === 'string' || value === undefined ? value : undefined, ownerId);
  }
}

export async function trashArchiveSession(
  session: ArchiveSession,
  userId: string
): Promise<{ cloudSynced: boolean }> {
  const localId = session._isLocal ? session.id : undefined;
  let cloudId = session._hasCloudCopy ? (session._linkedCloudId || session.id) : undefined;
  if (localId && !cloudId) {
    try {
      const fresh = await LocalDocumentService.getDocument(localId, userId);
      if (fresh?.linkedCloudId) cloudId = fresh.linkedCloudId;
    } catch { /* намеренно: берём снимок; StorageService повторит поиск и скажет, если не смог */ }
  }
  const result = await StorageService.trashDocument(userId, localId, cloudId);
  emitDomainEvent({ type: 'note.trashed', documentId: session.id });
  useActivityLogStore.getState().addActivity('activity_note_trashed', undefined, 'info', 'archive');
  return result;
}

export async function restoreArchiveSession(
  session: ArchiveSession,
  userId: string
): Promise<{ cloudSynced: boolean }> {
  const localId = session._isLocal ? session.id : undefined;
  let cloudId = session._hasCloudCopy ? (session._linkedCloudId || session.id) : undefined;
  if (localId && !cloudId) {
    try {
      const fresh = await LocalDocumentService.getDocument(localId, userId);
      if (fresh?.linkedCloudId) cloudId = fresh.linkedCloudId;
    } catch { /* намеренно: берём снимок; StorageService повторит поиск и скажет, если не смог */ }
  }
  const result = await StorageService.restoreDocument(userId, localId, cloudId);
  emitDomainEvent({ type: 'note.restored', documentId: session.id });
  useActivityLogStore.getState().addActivity('activity_note_restored', undefined, 'info', 'archive');
  return result;
}

export async function emptyTrash(
  trashedSessions: ArchiveSession[],
  userId: string
): Promise<{ successCount: number; failCount: number; deletedIds: string[] }> {
  let successCount = 0;
  let failCount = 0;
  const deletedIds: string[] = [];
  for (const session of trashedSessions) {
    try {
      const res = await deleteArchiveSession(session, userId, { skipActivityLog: true });
      if (!res.applied || res.derivativesOk === false) {
        failCount++;
      } else {
        successCount++;
        deletedIds.push(session.id);
      }
    } catch (e) {
      failCount++;
      reportError(e, { action: 'emptyTrash_single', sessionId: session.id });
    }
  }
  useActivityLogStore.getState().addActivity(
    failCount > 0 ? 'activity_trash_cleared_partial' : 'activity_trash_cleared',
    failCount > 0 ? { success: successCount, failed: failCount } : { count: successCount },
    failCount > 0 ? 'warning' : 'info', 'archive');
  return { successCount, failCount, deletedIds };
}

export async function deleteArchiveSession(
  session: ArchiveSession,
  userId: string,
  opts?: { skipActivityLog?: boolean }
): Promise<{ cloudSynced: boolean; derivativesOk: boolean; applied: boolean }> {
  const localId = session._isLocal ? session.id : undefined;
  let cloudId = session._hasCloudCopy ? (session._linkedCloudId || session.id) : undefined;
  // The snapshot above was captured when the confirm dialog opened; a background
  // sync can link a cloud copy in between. Trusting the stale flag deletes only the
  // local copy and orphans the cloud document, which then reappears in the archive.
  if (localId && !cloudId) {
    try {
      const fresh = await LocalDocumentService.getDocument(localId, userId);
      if (fresh?.linkedCloudId) cloudId = fresh.linkedCloudId;
    } catch { /* намеренно: берём снимок; StorageService повторит поиск и скажет, если не смог */ }
  }
  const result = await StorageService.deleteDocument(userId, localId, cloudId);
  if (!result.applied) {
    return result;
  }
  emitDomainEvent({ type: 'note.deleted', documentId: session.id });
  if (result.derivativesOk === false) {
    // N-51: заметка удалена, а часть её разборов ИИ — нет. «Удалено навсегда»
    // без оговорки было бы неправдой.
    useActivityLogStore.getState().addActivity(
      'activity_note_deleted_derivatives',
      { action: 'deleteArchiveSession_derivatives', documentId: session.id }, 'warning', 'archive');
  } else if (!opts?.skipActivityLog) {
    useActivityLogStore.getState().addActivity('activity_note_deleted', undefined, 'info', 'archive');
  }
  return result;
}

export const TRASH_EXPIRATION_MS = 10 * 24 * 60 * 60 * 1000;

export async function pruneExpiredTrash(
  sessions: ArchiveSession[],
  userId: string,
  now: number = Date.now()
): Promise<{ prunedCount: number; remainingSessions: ArchiveSession[] }> {
  const expired: ArchiveSession[] = [];
  const remainingSessions: ArchiveSession[] = [];

  for (const s of sessions) {
    if (s.trashedAt && (now - s.trashedAt > TRASH_EXPIRATION_MS)) {
      expired.push(s);
    } else {
      remainingSessions.push(s);
    }
  }

  // N-50: из списка уходит только то, что действительно удалено. Неудалённое
  // остаётся видимым в корзине — иначе интерфейс говорил бы «удалено», а
  // заметка лежала бы и на устройстве, и в облаке. Повтор — при следующем открытии.
  let prunedCount = 0;
  if (expired.length > 0) {
    const results = await Promise.allSettled(expired.map(s => deleteArchiveSession(s, userId, { skipActivityLog: true })));
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value.applied && r.value.derivativesOk !== false) {
        prunedCount++;
      } else {
        if (r.status === 'rejected') {
          reportError(r.reason, { action: 'pruneExpiredTrash_single', sessionId: expired[i]!.id });
        }
        remainingSessions.push(expired[i]!);
      }
    });
  }

  return { prunedCount, remainingSessions };
}
