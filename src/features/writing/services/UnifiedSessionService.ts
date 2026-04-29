import { DocumentService } from './DocumentService';
import { VersionService } from './VersionService';
import { LocalDocumentService } from './LocalDocumentService';
import { LocalVersionService } from './LocalVersionService';
import { StorageService, SaveDocumentData } from './StorageService';
import { LocalDocument } from '../../../shared/lib/localDb';
import { Document } from '../../../types';

export interface SaveSessionData {
  title: string;
  content: string;
  wordCount: number;
  duration: number;
  wpm: number;
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
  tags: string[];
  labelId?: string;
  _isLocal: boolean;
}

function toSaveData(data: SaveSessionData): SaveDocumentData {
  return {
    title: data.title,
    content: data.content,
    wordCount: data.wordCount,
    duration: data.duration,
    wpm: data.wpm,
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
    data: SaveSessionData
  ): Promise<{ documentId: string }> {
    const result = await StorageService.saveNew(userId, toSaveData(data));
    return { documentId: result.localId };
  },

  async saveAsVersion(
    userId: string,
    documentId: string,
    data: SaveSessionData
  ): Promise<void> {
    await StorageService.saveVersion(userId, documentId, toSaveData(data));
  },

  async getAllDocuments(
    userId: string
  ): Promise<{ local: LocalDocument[]; cloud: Document[]; all: UnifiedDocument[] }> {
    const [localDocs, cloudDocs] = await Promise.all([
      LocalDocumentService.getGuestDocuments(userId),
      DocumentService.getUserDocuments(userId).catch(() => [] as Document[]),
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
        tags: d.tags,
        labelId: d.labelId,
        _isLocal: false,
      })),
      ...uniqueLocal.map(d => ({
        id: d.id,
        title: d.title,
        currentVersion: d.currentVersion,
        totalWords: d.totalWords,
        totalDuration: d.totalDuration,
        sessionsCount: d.sessionsCount,
        lastSessionAt: d.lastSessionAt,
        tags: d.tags,
        _isLocal: true,
      })),
    ];

    return { local: uniqueLocal, cloud: cloudDocs, all };
  },
};
