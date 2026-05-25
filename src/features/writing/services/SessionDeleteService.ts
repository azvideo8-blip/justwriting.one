import { SessionService } from '../../../core/services/SessionService';
import { StorageService } from '../../../core/services/StorageService';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { Session } from '../../../types';

interface LegacySession extends Session {
  _isLegacy?: boolean;
}

export async function deleteSession(userId: string, session: Session): Promise<void> {
  if (session._isLocal) {
    const doc = await LocalDocumentService.getDocument(session.id);
    const cloudId = doc?.linkedCloudId || undefined;
    await StorageService.deleteDocument(userId, session.id, cloudId);
  } else if ((session as LegacySession)._isLegacy) {
    await SessionService.deleteSession(session.id);
  } else {
    await StorageService.deleteDocument(userId, undefined, session.id);
  }
}
