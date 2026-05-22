import { User } from 'firebase/auth';
import { DocumentService } from '../../writing/services/DocumentService';
import { LocalDocumentService } from '../../writing/services/LocalDocumentService';
import { SessionService } from '../../writing/services/SessionService';
import { StorageService } from '../../writing/services/StorageService';
import { ArchiveSession } from '../types';
import { reportError } from '../../../core/errors/reportError';

type ArchiveField = 'tags' | 'title' | 'date' | 'labelId';
type ArchiveFieldValue = string[] | string | Date | undefined;

export async function updateArchiveField(
  session: ArchiveSession,
  field: ArchiveField,
  value: ArchiveFieldValue,
  user: User | null,
  userId: string
): Promise<void> {
  if (session._isLegacy) {
    const patch: Record<string, unknown> = {};
    if (field === 'tags') patch.tags = value;
    else if (field === 'title') patch.title = value;
    else if (field === 'date') {
      if (!(value instanceof Date)) throw new Error('Expected Date for date field');
      patch.sessionStartTime = value.getTime();
    }
    else if (field === 'labelId') patch.labelId = value;
    await SessionService.updateSession(session.id, patch);
    return;
  }

  if (session._isLocal) {
    if (field === 'tags') {
      await LocalDocumentService.updateTags(session.id, value as string[]);
      if (session._linkedCloudId && user) {
        await DocumentService.updateTags(user.uid, session._linkedCloudId, value as string[]).catch(e => { reportError(e, { action: 'updateArchiveField_tags', documentId: session._linkedCloudId }); });
      }
    } else if (field === 'title') {
      await LocalDocumentService.updateTitle(session.id, value as string);
      if (session._linkedCloudId && user) {
        await DocumentService.updateTitle(user.uid, session._linkedCloudId, value as string).catch(e => { reportError(e, { action: 'updateArchiveField_title', documentId: session._linkedCloudId }); });
      }
    } else if (field === 'date') {
      if (!(value instanceof Date)) throw new Error('Expected Date for date field');
      const ts = value.getTime();
      await LocalDocumentService.updateDate(session.id, ts, ts);
      if (session._linkedCloudId && user) {
        await DocumentService.updateDate(user.uid, session._linkedCloudId, value, value).catch(e => { reportError(e, { action: 'updateArchiveField_date', documentId: session._linkedCloudId }); });
      }
    } else if (field === 'labelId') {
      await LocalDocumentService.updateLabelId(session.id, value as string | undefined);
      if (session._linkedCloudId && user) {
        await DocumentService.updateLabelId(user.uid, session._linkedCloudId, value as string | undefined).catch(e => { reportError(e, { action: 'updateArchiveField_labelId', documentId: session._linkedCloudId }); });
      }
    }
    return;
  }

  if (user) {
    if (field === 'tags') {
      await DocumentService.updateTags(user.uid, session.id, value as string[]);
    } else if (field === 'title') {
      await DocumentService.updateTitle(user.uid, session.id, value as string);
    } else if (field === 'date') {
      if (!(value instanceof Date)) throw new Error('Expected Date for date field');
      await DocumentService.updateDate(user.uid, session.id, value, value);
    } else if (field === 'labelId') {
      await DocumentService.updateLabelId(user.uid, session.id, value as string | undefined);
    }
  }
}

export async function deleteArchiveSession(
  session: ArchiveSession,
  userId: string
): Promise<void> {
  if (session._isLegacy) {
    await SessionService.deleteSession(session.id);
  } else {
    await StorageService.deleteDocument(
      userId,
      session._isLocal ? session.id : undefined,
      session._hasCloudCopy ? (session._linkedCloudId || session.id) : undefined
    );
  }
}
