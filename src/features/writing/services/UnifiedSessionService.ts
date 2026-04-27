import { DocumentService } from './DocumentService';
import { VersionService } from './VersionService';
import { LocalDocumentService } from './LocalDocumentService';
import { LocalVersionService } from './LocalVersionService';
import { SessionSource } from '../hooks/useSessionSource';
import { LocalDocument } from '../../../shared/lib/localDb';
import { Document } from '../../../types';

export interface SaveSessionData {
  title: string;
  content: string;
  wordCount: number;
  duration: number;
  wpm: number;
  isPublic: boolean;
  tags: string[];
  labelId?: string;
  goalWords?: number;
  goalTime?: number;
  goalReached?: boolean;
  sessionStartedAt: Date;
  existingDocumentId?: string;
}

export interface UnifiedDocument {
  id: string;
  title: string;
  currentVersion: number;
  totalWords: number;
  totalDuration: number;
  sessionsCount: number;
  lastSessionAt: number;
  isPublic: boolean;
  tags: string[];
  labelId?: string;
  _isLocal: boolean;
  _source: SessionSource;
}

export const UnifiedSessionService = {
  async saveAsNewDocument(
    userId: string,
    data: SaveSessionData,
    source: SessionSource
  ): Promise<{ documentId: string; source: SessionSource }> {
    if (source === 'local' || source === 'both') {
      const localId = await LocalDocumentService.createDocument(userId, {
        title: data.title,
        tags: data.tags,
      });
      await LocalVersionService.addVersion(userId, localId, {
        content: data.content,
        previousContent: '',
        wordCount: data.wordCount,
        duration: data.duration,
        wpm: data.wpm,
        versionNumber: 1,
        goalWords: data.goalWords,
        goalTime: data.goalTime,
        goalReached: data.goalReached,
        sessionStartedAt: data.sessionStartedAt,
      });
      await LocalDocumentService.updateAfterSession(localId, {
        totalWords: data.wordCount,
        totalDuration: data.duration,
        currentVersion: 1,
      });
      if (source === 'local') return { documentId: localId, source: 'local' };
    }

    if (source === 'cloud' || source === 'both') {
      const cloudId = await DocumentService.createDocument(userId, {
        title: data.title,
        isPublic: data.isPublic,
        tags: data.tags,
        labelId: data.labelId,
      });
      await VersionService.addVersion(userId, cloudId, {
        content: data.content,
        previousContent: '',
        wordCount: data.wordCount,
        duration: data.duration,
        wpm: data.wpm,
        versionNumber: 1,
        goalWords: data.goalWords,
        goalTime: data.goalTime,
        goalReached: data.goalReached,
        sessionStartedAt: data.sessionStartedAt,
      });
      await DocumentService.updateDocumentAfterSession(userId, cloudId, {
        totalWords: data.wordCount,
        totalDuration: data.duration,
        currentVersion: 1,
      });
      return { documentId: cloudId, source: 'cloud' };
    }

    throw new Error('Invalid source');
  },

  async saveAsVersion(
    userId: string,
    documentId: string,
    data: SaveSessionData,
    source: SessionSource
  ): Promise<void> {
    if (source === 'local' || source === 'both') {
      const existing = await LocalDocumentService.getDocument(documentId);
      if (existing) {
        const prevContent = await LocalVersionService.getLatestContent(documentId);
        const newVersion = existing.currentVersion + 1;
        await LocalVersionService.addVersion(userId, documentId, {
          content: data.content,
          previousContent: prevContent,
          wordCount: data.wordCount,
          duration: data.duration,
          wpm: data.wpm,
          versionNumber: newVersion,
          goalWords: data.goalWords,
          goalTime: data.goalTime,
          goalReached: data.goalReached,
          sessionStartedAt: data.sessionStartedAt,
        });
        await LocalDocumentService.updateAfterSession(documentId, {
          totalWords: data.wordCount,
          totalDuration: existing.totalDuration + data.duration,
          currentVersion: newVersion,
        });
      }
    }

    if (source === 'cloud' || source === 'both') {
      const existing = await DocumentService.getDocument(userId, documentId);
      if (existing) {
        const versions = await VersionService.getVersions(userId, documentId);
        const prevContent = versions[versions.length - 1]?.content ?? '';
        const newVersion = existing.currentVersion + 1;
        await VersionService.addVersion(userId, documentId, {
          content: data.content,
          previousContent: prevContent,
          wordCount: data.wordCount,
          duration: data.duration,
          wpm: data.wpm,
          versionNumber: newVersion,
          goalWords: data.goalWords,
          goalTime: data.goalTime,
          goalReached: data.goalReached,
          sessionStartedAt: data.sessionStartedAt,
        });
        await DocumentService.updateDocumentAfterSession(userId, documentId, {
          totalWords: data.wordCount,
          totalDuration: existing.totalDuration + data.duration,
          currentVersion: newVersion,
        });
      }
    }
  },

  async getAllDocuments(
    userId: string,
    source: SessionSource
  ): Promise<{ local: LocalDocument[]; cloud: Document[]; all: UnifiedDocument[] }> {
    const [localDocs, cloudDocs] = await Promise.all([
      source !== 'cloud'
        ? LocalDocumentService.getGuestDocuments(userId)
        : Promise.resolve([] as LocalDocument[]),
      source !== 'local'
        ? DocumentService.getUserDocuments(userId)
        : Promise.resolve([] as Document[]),
    ]);

    const cloudIds = new Set(cloudDocs.map(d => d.id));
    const uniqueLocal = localDocs.filter(d => !cloudIds.has(d.id));

    const all: UnifiedDocument[] = [
      ...cloudDocs.map(d => ({
        id: d.id,
        title: d.title,
        currentVersion: d.currentVersion,
        totalWords: d.totalWords,
        totalDuration: d.totalDuration,
        sessionsCount: d.sessionsCount,
        lastSessionAt: (d.lastSessionAt as { toDate?: () => Date }).toDate?.().getTime() ?? Date.now(),
        isPublic: d.isPublic,
        tags: d.tags,
        labelId: d.labelId,
        _isLocal: false,
        _source: 'cloud' as SessionSource,
      })),
      ...uniqueLocal.map(d => ({
        id: d.id,
        title: d.title,
        currentVersion: d.currentVersion,
        totalWords: d.totalWords,
        totalDuration: d.totalDuration,
        sessionsCount: d.sessionsCount,
        lastSessionAt: d.lastSessionAt,
        isPublic: false as const,
        tags: d.tags,
        _isLocal: true,
        _source: 'local' as SessionSource,
      })),
    ];

    return { local: uniqueLocal, cloud: cloudDocs, all };
  },
};
