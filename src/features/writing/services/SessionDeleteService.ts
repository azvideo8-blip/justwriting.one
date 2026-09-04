import { StorageService } from '../../../core/services/StorageService';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { Session } from '../../../types';

export async function deleteSession(userId: string, session: Session): Promise<{ cloudSynced: boolean }> {
  if (session._isLocal) {
    const doc = await LocalDocumentService.getDocument(session.id);
    const cloudId = doc?.linkedCloudId || undefined;
    return await StorageService.deleteDocument(userId, session.id, cloudId);
  } else {
    return await StorageService.deleteDocument(userId, undefined, session.id);
  }
}
