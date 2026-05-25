import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { LocalVersionService } from './LocalVersionService';
import { LocalSessionInfo } from '../types/session';

export async function fetchLocalSessions(userId: string): Promise<LocalSessionInfo[]> {
  const localDocs = await LocalDocumentService.getGuestDocuments(userId);
  return localDocs.map(d => ({
    id: d.id,
    createdAt: new Date(d.lastSessionAt),
    title: d.title,
    wordCount: d.totalWords,
    duration: d.totalDuration,
  }));
}

export async function loadLocalSession(docId: string): Promise<Record<string, unknown> | null> {
  const doc = await LocalDocumentService.getDocument(docId);
  if (!doc) return null;
  const content = await LocalVersionService.getLatestContent(docId);
  return {
    content,
    title: doc.title,
    wordCount: doc.totalWords,
    duration: doc.totalDuration,
    tags: doc.tags,
  } as Record<string, unknown>;
}
