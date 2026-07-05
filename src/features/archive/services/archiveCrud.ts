import { User } from 'firebase/auth';
import { DocumentService } from '../../../core/services/DocumentService';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { StorageService } from '../../../core/services/StorageService';
import { SyncService } from '../../../core/services/SyncService';
import { CloudSyncService } from '../../../core/services/CloudSyncService';
import { ArchiveSession } from '../types';
import { reportError } from '../../../shared/errors/reportError';

type ArchiveField = 'tags' | 'title' | 'date' | 'labelId';
type ArchiveFieldValue = string[] | string | Date | undefined;

export async function updateArchiveField(
  session: ArchiveSession,
  field: ArchiveField,
  value: ArchiveFieldValue,
  user: User | null,
  _userId: string
): Promise<{ success: boolean; cloudSyncFailed?: boolean }> {
  let cloudSyncFailed = false;

  if (session._isLocal) {
    if (field === 'tags') {
      const tags = Array.isArray(value) ? value : [];
      await LocalDocumentService.updateTags(session.id, tags);
      if (session._linkedCloudId && user) {
        await DocumentService.updateTags(user.uid, session._linkedCloudId, tags).catch(e => {
          cloudSyncFailed = true;
          reportError(e, { action: 'updateArchiveField_tags', documentId: session._linkedCloudId });
          // Queue the LOCAL id — the drain (_drainPendingQueue -> addCloudCopy)
          // looks up a local IndexedDB document by this id, not a cloud one.
          void SyncService.addToQueue(session.id);
        });
      }
    } else if (field === 'title') {
      const title = typeof value === 'string' ? value : '';
      await LocalDocumentService.updateTitle(session.id, title);
      if (session._linkedCloudId && user) {
        await DocumentService.updateTitle(user.uid, session._linkedCloudId, title).catch(e => {
          cloudSyncFailed = true;
          reportError(e, { action: 'updateArchiveField_title', documentId: session._linkedCloudId });
          // Queue the LOCAL id — the drain (_drainPendingQueue -> addCloudCopy)
          // looks up a local IndexedDB document by this id, not a cloud one.
          void SyncService.addToQueue(session.id);
        });
      }
    } else if (field === 'date') {
      if (!(value instanceof Date)) throw new Error('Expected Date for date field');
      const ts = value.getTime();
      await LocalDocumentService.updateDate(session.id, ts, ts);
      if (session._linkedCloudId && user) {
        await DocumentService.updateDate(user.uid, session._linkedCloudId, value, value).catch(e => {
          cloudSyncFailed = true;
          reportError(e, { action: 'updateArchiveField_date', documentId: session._linkedCloudId });
          // Queue the LOCAL id — the drain (_drainPendingQueue -> addCloudCopy)
          // looks up a local IndexedDB document by this id, not a cloud one.
          void SyncService.addToQueue(session.id);
        });
      }
    } else if (field === 'labelId') {
      const labelId = typeof value === 'string' || value === undefined ? value : undefined;
      await LocalDocumentService.updateLabelId(session.id, labelId);
      if (session._linkedCloudId && user) {
        await DocumentService.updateLabelId(user.uid, session._linkedCloudId, labelId).catch(e => {
          cloudSyncFailed = true;
          reportError(e, { action: 'updateArchiveField_labelId', documentId: session._linkedCloudId });
          // Queue the LOCAL id — the drain (_drainPendingQueue -> addCloudCopy)
          // looks up a local IndexedDB document by this id, not a cloud one.
          void SyncService.addToQueue(session.id);
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
        if (value instanceof Date) await DocumentService.updateDate(user.uid, session.id, value, value);
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
        await _applyLocalFieldEdit(localId, field, value);
        void SyncService.addToQueue(localId);
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
  value: ArchiveFieldValue
): Promise<void> {
  if (field === 'tags') {
    await LocalDocumentService.updateTags(localId, Array.isArray(value) ? value : []);
  } else if (field === 'title') {
    await LocalDocumentService.updateTitle(localId, typeof value === 'string' ? value : '');
  } else if (field === 'date') {
    if (value instanceof Date) {
      await LocalDocumentService.updateDate(localId, value.getTime(), value.getTime());
    }
  } else if (field === 'labelId') {
    await LocalDocumentService.updateLabelId(localId, typeof value === 'string' || value === undefined ? value : undefined);
  }
}

export async function deleteArchiveSession(
  session: ArchiveSession,
  userId: string
): Promise<void> {
  await StorageService.deleteDocument(
    userId,
    session._isLocal ? session.id : undefined,
    session._hasCloudCopy ? (session._linkedCloudId || session.id) : undefined
  );
}
