import { Document } from '../../types';
import { DocumentDb } from '../data/schemas';
import { toDate } from '../utils/dateUtils';

export function documentFromDb(dbDoc: DocumentDb): Document {
  return {
    id: dbDoc.id,
    uuid: dbDoc.uuid,
    userId: dbDoc.userId,
    title: dbDoc.title,
    currentVersion: dbDoc.currentVersion,
    totalWords: dbDoc.totalWords,
    totalDuration: dbDoc.totalDuration,
    sessionsCount: dbDoc.sessionsCount,
    firstSessionAt: toDate(dbDoc.firstSessionAt) ?? null,
    lastSessionAt: toDate(dbDoc.lastSessionAt) ?? null,
    isPublic: dbDoc.isPublic,
    tags: dbDoc.tags,
    labelId: dbDoc.labelId ?? undefined,
    mood: dbDoc.mood,
    excludedFromAI: dbDoc.excludedFromAI ?? false,
    _locked: dbDoc._locked,
    _decryptionError: dbDoc._decryptionError,
    deletedAt: toDate(dbDoc.deletedAt) ?? null,
    trashedAt: toDate(dbDoc.trashedAt) ?? null,
    createdAt: toDate(dbDoc.createdAt) ?? null,
    updatedAt: toDate(dbDoc.updatedAt) ?? null,
  } as Document;
}
