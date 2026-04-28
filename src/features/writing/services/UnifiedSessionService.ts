import { DocumentService } from './DocumentService';
import { VersionService } from './VersionService';
import { LocalDocumentService } from './LocalDocumentService';
import { LocalVersionService } from './LocalVersionService';
import { StorageService, SaveDocumentData } from './StorageService';
import { SessionSource } from '../hooks/useSessionSource';
import { LocalDocument, getOrCreateGuestId } from '../../../shared/lib/localDb';
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

function toSaveData(data: SaveSessionData): SaveDocumentData {
  return {
    title: data.title,
    content: data.content,
    wordCount: data.wordCount,
    duration: data.duration,
    wpm: data.wpm,
    isPublic: data.isPublic,
    tags: data.tags,
    labelId: data.labelId,
    goalWords: data.goalWords,
    goalTime: data.goalTime,
    goalReached: data.goalReached,
    sessionStartedAt: data.sessionStartedAt,
  };
}

export const UnifiedSessionService = {
  async saveAsNewDocument(
    userId: string,
    data: SaveSessionData,
    source: SessionSource
  ): Promise<{ documentId: string; source: SessionSource }> {
    const result = await StorageService.saveNew(userId, toSaveData(data), source);

    if (result.localId && result.cloudId) {
      await LocalDocumentService.updateLinkedCloudId(result.localId, result.cloudId);
    }

    if (source === 'local' && result.localId) {
      return { documentId: result.localId, source: 'local' };
    }
    if (result.cloudId) {
      return { documentId: result.cloudId, source: 'cloud' };
    }
    if (result.localId) {
      return { documentId: result.localId, source: 'local' };
    }

    throw new Error('Save failed: no document ID returned');
  },

  async saveAsVersion(
    userId: string,
    documentId: string,
    data: SaveSessionData,
    source: SessionSource
  ): Promise<void> {
    const isLocal = documentId.startsWith('local_');
    await StorageService.saveVersion(userId, documentId, toSaveData(data), source, isLocal);
  },

  async getAllDocuments(
    userId: string,
    source: SessionSource
  ): Promise<{ local: LocalDocument[]; cloud: Document[]; all: UnifiedDocument[] }> {
    const [localDocs, cloudDocs] = await Promise.all([
      source !== 'cloud'
        ? LocalDocumentService.getGuestDocuments(getOrCreateGuestId())
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
