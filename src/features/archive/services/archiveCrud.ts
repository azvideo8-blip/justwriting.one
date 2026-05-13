import { User } from 'firebase/auth';
import { DocumentService } from '../../writing/services/DocumentService';
import { LocalDocumentService } from '../../writing/services/LocalDocumentService';
import { SessionService } from '../../writing/services/SessionService';
import { ArchiveSession } from '../types';

type ArchiveField = 'tags' | 'title' | 'date' | 'labelId';
type ArchiveFieldValue = string[] | string | Date | string | undefined;

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
    else if (field === 'date') patch.sessionStartTime = (value as Date).getTime();
    else if (field === 'labelId') patch.labelId = value;
    await SessionService.updateSession(session.id, patch);
    return;
  }

  if (session._isLocal) {
    if (field === 'tags') {
      await LocalDocumentService.updateTags(session.id, value as string[]);
      if (session._linkedCloudId && user) {
        await DocumentService.updateTags(user.uid, session._linkedCloudId, value as string[]).catch(() => {});
      }
    } else if (field === 'title') {
      await LocalDocumentService.updateTitle(session.id, value as string);
      if (session._linkedCloudId && user) {
        await DocumentService.updateTitle(user.uid, session._linkedCloudId, value as string).catch(() => {});
      }
    } else if (field === 'date') {
      const ts = (value as Date).getTime();
      await LocalDocumentService.updateDate(session.id, ts, ts);
      if (session._linkedCloudId && user) {
        await DocumentService.updateDate(user.uid, session._linkedCloudId, value as Date, value as Date).catch(() => {});
      }
    } else if (field === 'labelId') {
      await LocalDocumentService.updateLabelId(session.id, value as string | undefined);
      if (session._linkedCloudId && user) {
        await DocumentService.updateLabelId(user.uid, session._linkedCloudId, value as string | undefined).catch(() => {});
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
      await DocumentService.updateDate(user.uid, session.id, value as Date, value as Date);
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
    await (await import('../../writing/services/StorageService')).StorageService.deleteDocument(
      userId,
      session._isLocal ? session.id : undefined,
      session._hasCloudCopy ? (session._linkedCloudId || session.id) : undefined
    );
  }
}
