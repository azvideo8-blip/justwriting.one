import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance } from '../../../core/storage/localDb';
import { LocalStoreSyncService } from '../../../core/services/LocalStoreSyncService';

const mockSaveRecord = vi.fn();
const mockDeleteRecord = vi.fn();
const mockGetRecords = vi.fn();

vi.mock('../../../core/data', () => ({
  DataProvider: {
    saveLocalStoreRecord: (...args: unknown[]) => mockSaveRecord(...args),
    deleteLocalStoreRecord: (...args: unknown[]) => mockDeleteRecord(...args),
    getLocalStoreRecords: (...args: unknown[]) => mockGetRecords(...args),
  },
}));

let mockCurrentUser: { uid: string; email: string } | null = null;
vi.mock('../../../core/auth', () => ({
  getCurrentUser: () => mockCurrentUser,
  signIn: vi.fn(async (email: string) => {
    const uid = email.startsWith('a') ? 'user_a' : 'user_b';
    mockCurrentUser = { uid, email };
    return mockCurrentUser;
  }),
  signOutUser: vi.fn(async () => {
    mockCurrentUser = null;
  }),
}));

vi.mock('../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeEncrypt: vi.fn(async (payload: Record<string, unknown>) => ({ ...payload, _encrypted: false })),
  maybeDecrypt: vi.fn(async (payload: Record<string, unknown>) => payload),
}));

vi.mock('../../../core/crypto/encrypt', () => ({
  getSessionKey: () => ({} as CryptoKey),
}));

import { AuthService } from '../services/AuthService';

describe('AG-ISO-1: Account Isolation for Local Database', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetDbInstance();
    mockCurrentUser = null;
  });

  it('Account A writes a portrait and chat memories; Account B signs in without wiping -> B sees no portrait and no memories', async () => {
    // 1. Account A signs in
    mockCurrentUser = { uid: 'user_a', email: 'a@example.com' };
    const dbA = await getLocalDb();
    await dbA.put('aiPortrait', {
      id: 'singleton',
      portrait: 'Portrait of User A: sensitive personal psychological profile',
      updatedAt: Date.now(),
      generatedAtDelta: 0,
    });
    await dbA.put('aiChatMemory', {
      id: 'mem_1',
      kind: 'fact',
      text: 'User A private memory',
      sourceDialogueId: 'd1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // 2. User A signs out without wiping local data (the default)
    await AuthService.signOut({ clearLocalData: false });

    // 3. User B signs in on the same browser
    mockCurrentUser = { uid: 'user_b', email: 'b@example.com' };
    const dbB = await getLocalDb();

    // B should see NO portrait and NO memories belonging to A
    const portraitB = await dbB.get('aiPortrait', 'singleton');
    const memoriesB = await dbB.getAll('aiChatMemory');

    expect(portraitB).toBeUndefined();
    expect(memoriesB).toHaveLength(0);
  });

  it('Account B running derived-data upload uploads ZERO records from Account A', async () => {
    // 1. Account A writes data
    mockCurrentUser = { uid: 'user_a', email: 'a@example.com' };
    const dbA = await getLocalDb();
    await dbA.put('aiPortrait', {
      id: 'singleton',
      portrait: 'Portrait of User A',
      updatedAt: Date.now(),
      generatedAtDelta: 0,
    });

    // 2. User A signs out without wiping
    await AuthService.signOut({ clearLocalData: false });

    // 3. User B signs in
    mockCurrentUser = { uid: 'user_b', email: 'b@example.com' };

    // User B runs syncAllLocalStores
    await LocalStoreSyncService.syncAllLocalStores('user_b');

    // Assert that ZERO records from User A reach the cloud under user_b
    expect(mockSaveRecord).not.toHaveBeenCalledWith(
      'user_b',
      'aiPortrait',
      expect.anything(),
      expect.objectContaining({ data: expect.stringContaining('Portrait of User A') }),
    );
  });

  it('Guest -> sign-up migration carries the guests own data across to the new user database', async () => {
    // 1. Guest writes notes
    mockCurrentUser = null;
    const guestDb = await getLocalDb();
    const { getOrCreateGuestId } = await import('../../../shared/utils/guestId');
    const guestId = getOrCreateGuestId();
    await guestDb.put('documents', {
      id: 'doc_g1',
      guestId,
      title: 'Guest Note',
      currentVersion: 1,
      totalWords: 10,
      totalDuration: 60,
      sessionsCount: 1,
      firstSessionAt: Date.now(),
      lastSessionAt: Date.now(),
      tags: [],
    });
    await guestDb.put('versions', {
      id: 'ver_g1',
      documentId: 'doc_g1',
      guestId,
      version: 1,
      content: 'Guest text',
      wordCount: 10,
      wordsAdded: 10,
      charsAdded: 50,
      duration: 60,
      wpm: 10,
      savedAt: Date.now(),
      sessionStartedAt: Date.now(),
    });

    // 2. User signs up and migrates
    const { migrateDocuments } = await import('../services/migrateDocuments');
    mockCurrentUser = { uid: 'user_new', email: 'new@example.com' };
    const count = await migrateDocuments('user_new');

    expect(count).toBe(1);

    // 3. User database has the document with guestId = user_new
    const userDb = await getLocalDb('user_new');
    const userDoc = await userDb.get('documents', 'doc_g1');
    expect(userDoc).toBeDefined();
    expect(userDoc?.guestId).toBe('user_new');

    // 4. Guest documents query for guestId returns empty
    const remainingGuestDocs = await guestDb.getAllFromIndex('documents', 'by-guest', guestId);
    expect(remainingGuestDocs).toHaveLength(0);
  });
});

