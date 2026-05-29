import { Session, Document, UserProfile } from '../../types';
import type { Version } from '../../types';
import type { LocalDocument } from '../../core/storage/localDb';

export function createSession(overrides: Partial<Session> = {}): Session {
  return {
    id: `session_${Math.random().toString(36).slice(2)}`,
    userId: 'test_user',
    content: 'Test content',
    title: 'Test Session',
    wordCount: 10,
    charCount: 50,
    duration: 300,
    wpm: 30,
    tags: [],
    createdAt: new Date(),
    ...overrides,
  };
}

export function createDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: `doc_${Math.random().toString(36).slice(2)}`,
    userId: 'test_user',
    title: 'Test Document',
    currentVersion: 1,
    totalWords: 100,
    totalDuration: 600,
    sessionsCount: 1,
    tags: [],
    firstSessionAt: new Date() as any,
    lastSessionAt: new Date() as any,
    ...overrides,
  };
}

export function createUserProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'test_user',
    email: 'test@example.com',
    nickname: 'Test User',
    ...overrides,
  };
}

export function createMockSession(overrides?: Partial<Session>): Session {
  return {
    id: 'session_mock_1',
    userId: 'user_mock_1',
    content: 'Mock session content',
    title: 'Mock Title',
    duration: 300,
    wordCount: 50,
    charCount: 250,
    wpm: 30,
    createdAt: new Date(),
    tags: [],
    ...overrides,
  } as Session;
}

export function createMockDocument(overrides?: Partial<Document>): Document {
  return {
    id: 'doc_mock_1',
    userId: 'user_mock_1',
    title: 'Mock Document',
    currentVersion: 1,
    totalWords: 100,
    totalDuration: 600,
    sessionsCount: 1,
    firstSessionAt: new Date() as any,
    lastSessionAt: new Date() as any,
    tags: [],
    ...overrides,
  } as Document;
}

export function createMockVersion(overrides?: Partial<Version>): Version {
  return {
    id: 'ver_mock_1',
    documentId: 'doc_mock_1',
    userId: 'user_mock_1',
    version: 1,
    content: 'Mock version content',
    wordCount: 10,
    wordsAdded: 10,
    charsAdded: 50,
    duration: 120,
    wpm: 25,
    savedAt: new Date() as any,
    sessionStartedAt: new Date() as any,
    ...overrides,
  } as Version;
}

export function createMockLocalDocument(overrides?: Partial<LocalDocument>): LocalDocument {
  return {
    id: 'local_mock_1',
    guestId: 'user_mock_1',
    title: 'Mock Local Doc',
    currentVersion: 1,
    totalWords: 100,
    totalDuration: 600,
    sessionsCount: 1,
    firstSessionAt: Date.now(),
    lastSessionAt: Date.now(),
    tags: [],
    ...overrides,
  } as LocalDocument;
}
