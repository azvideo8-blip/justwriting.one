import { Session, Document, UserProfile } from '../../types';

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
