import { SessionService } from './SessionService';
import { StorageService } from './StorageService';
import { LocalDocumentService } from './LocalDocumentService';
import { Session } from '../../../types';

export async function deleteSession(userId: string, session: Session): Promise<void> {
  if (session._isLocal) {
    const doc = await LocalDocumentService.getDocument(session.id);
    const cloudId = doc?.linkedCloudId || undefined;
    await StorageService.deleteDocument(userId, session.id, cloudId);
  } else if ((session as any)._isLegacy) {
    await SessionService.deleteSession(session.id);
  } else {
    await StorageService.deleteDocument(userId, undefined, session.id);
  }
}
