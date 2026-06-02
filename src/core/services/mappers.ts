import { Document, Version } from '../../types';
import { DocumentDb, VersionDb } from '../firebase/schemas/firestoreSchemas';
import { toDate } from '../utils/dateUtils';

export function documentFromDb(dbDoc: DocumentDb): Document {
  return {
    id: dbDoc.id,
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
  } as Document;
}

export function versionFromDb(dbVer: VersionDb): Version {
  return {
    id: dbVer.id,
    documentId: dbVer.documentId,
    userId: dbVer.userId,
    version: dbVer.version,
    content: dbVer.content,
    wordCount: dbVer.wordCount,
    wordsAdded: dbVer.wordsAdded,
    charsAdded: dbVer.charsAdded,
    duration: dbVer.duration,
    wpm: dbVer.wpm,
    goalWords: dbVer.goalWords ?? undefined,
    goalTime: dbVer.goalTime ?? undefined,
    goalReached: dbVer.goalReached,
    savedAt: toDate(dbVer.savedAt) ?? null,
    sessionStartedAt: toDate(dbVer.sessionStartedAt) ?? null,
    mood: dbVer.mood,
  } as Version;
}
