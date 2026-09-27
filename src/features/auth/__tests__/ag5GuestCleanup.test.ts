import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getLocalDb, resetDbInstance } from '../../../core/storage/localDb';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { migrateDocuments } from '../services/migrateDocuments';
import { AuthService } from '../services/AuthService';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';

// Mock auth module
let mockCurrentUser: { uid: string; email?: string } | null = null;
vi.mock('../../../core/auth', () => ({
  getCurrentUser: () => mockCurrentUser,
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOutUser: vi.fn(async () => {
    mockCurrentUser = null;
  }),
  sendPasswordResetEmail: vi.fn(),
  reauthenticate: vi.fn(),
}));

// Mock localDb's getOrCreateGuestId to a predictable test guestId
const GUEST_ID = 'guest_test_ag5';
const USER_ID = 'user_acc_ag5';

vi.mock('../../../core/storage/localDb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../core/storage/localDb')>();
  return {
    ...actual,
    getOrCreateGuestId: () => GUEST_ID,
  };
});

async function resetAllDatabases(): Promise<void> {
  resetDbInstance();
  for (const name of ['justwriting-local', `justwriting-local-${USER_ID}`]) {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  }
}

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  mockCurrentUser = null;
  await resetAllDatabases();
});

afterEach(() => {
  resetDbInstance();
  vi.restoreAllMocks();
});

describe('AG-5: Guest notes migration cleanup & atomicity', () => {
  it('Requirement 1 & 2: after migration, justwriting-local has NO notes, versions, or draft for guest, and user DB has all data intact', async () => {
    // 1. Guest writes notes and draft
    const docId = await LocalDocumentService.createDocument(GUEST_ID, {
      title: 'Secret Guest Note',
      tags: ['personal', 'diary'],
    });

    await LocalVersionService.addVersion(GUEST_ID, docId, {
      content: 'Secret content version 1',
      previousContent: '',
      wordCount: 4,
      duration: 30,
      wpm: 8,
      versionNumber: 1,
      sessionStartedAt: new Date(Date.now() - 10000),
    });

    await LocalVersionService.addVersion(GUEST_ID, docId, {
      content: 'Secret content version 2',
      previousContent: 'Secret content version 1',
      wordCount: 4,
      duration: 30,
      wpm: 8,
      versionNumber: 2,
      sessionStartedAt: new Date(Date.now()),
    });

    const guestDb = await getLocalDb('justwriting-local');
    await guestDb.put('drafts', {
      userId: 'guest_draft',
      title: 'Secret Draft',
      content: 'Guest draft body text',
      seconds: 15,
      wpm: 20,
      wordCount: 4,
      updatedAt: Date.now(),
    });
    localStorage.setItem(STORAGE_KEYS.GUEST_DRAFT, JSON.stringify({ content: 'Guest draft body text' }));

    // 2. Perform migration to user account
    const { moved } = await migrateDocuments(USER_ID);
    expect(moved).toBe(1);

    // 3. Verify guest database (justwriting-local) is completely clean:
    // No documents under guestId or userId
    const guestRemainingDocs = await guestDb.getAll('documents');
    expect(guestRemainingDocs).toHaveLength(0);

    // No versions under guestId or userId
    const guestRemainingVersions = await guestDb.getAll('versions');
    expect(guestRemainingVersions).toHaveLength(0);

    // No drafts under guest_draft or userId
    expect(await guestDb.get('drafts', 'guest_draft')).toBeUndefined();
    expect(await guestDb.get('drafts', USER_ID)).toBeUndefined();
    expect(localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT)).toBeNull();

    // 4. Verify user database (justwriting-local-USER_ID) has all migrated data:
    const userDb = await getLocalDb(USER_ID);
    const userDocs = await userDb.getAll('documents');
    expect(userDocs).toHaveLength(1);
    expect(userDocs[0]?.id).toBe(docId);
    expect(userDocs[0]?.title).toBe('Secret Guest Note');
    expect(userDocs[0]?.tags).toEqual(['personal', 'diary']);
    expect(userDocs[0]?.guestId).toBe(USER_ID);

    const userVersions = await userDb.getAll('versions');
    expect(userVersions).toHaveLength(2);
    userVersions.sort((a, b) => a.version - b.version);
    expect(userVersions[0]?.content).toBe('Secret content version 1');
    expect(userVersions[0]?.guestId).toBe(USER_ID);
    expect(userVersions[1]?.content).toBe('Secret content version 2');
    expect(userVersions[1]?.guestId).toBe(USER_ID);

    const userDraft = await userDb.get('drafts', USER_ID);
    expect(userDraft).toBeDefined();
    expect(userDraft?.content).toBe('Guest draft body text');
    expect(userDraft?.userId).toBe(USER_ID);
  });

  it('Requirement 3: failed write to user DB leaves guest DB completely untouched with original guestId', async () => {
    // 1. Seed guest doc and versions
    const docId = await LocalDocumentService.createDocument(GUEST_ID, {
      title: 'Do Not Lose This Note',
    });

    await LocalVersionService.addVersion(GUEST_ID, docId, {
      content: 'Important guest content',
      previousContent: '',
      wordCount: 3,
      duration: 20,
      wpm: 9,
      versionNumber: 1,
      sessionStartedAt: new Date(),
    });

    const guestDb = await getLocalDb('justwriting-local');

    // 2. Mock userDb transaction to fail on document migration
    localStorage.setItem(`jw_legacy_migrated_${USER_ID}`, '1');
    const userDb = await getLocalDb(USER_ID);
    const origTx = userDb.transaction.bind(userDb);
    vi.spyOn(userDb, 'transaction').mockImplementation((storeNames, ...rest) => {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      if (names.includes('documents')) {
        throw new Error('SIMULATED_USER_TX_FAILURE');
      }
      return origTx(storeNames, ...rest);
    });

    // 3. Migration reports failed document as left
    const failRes = await migrateDocuments(USER_ID);
    expect(failRes).toEqual({ moved: 0, left: 1 });

    // 4. Verify guest DB is untouched: document and versions still present with GUEST_ID
    const remainingDocs = await guestDb.getAll('documents');
    expect(remainingDocs).toHaveLength(1);
    expect(remainingDocs[0]?.id).toBe(docId);
    expect(remainingDocs[0]?.title).toBe('Do Not Lose This Note');
    expect(remainingDocs[0]?.guestId).toBe(GUEST_ID);

    const remainingVersions = await guestDb.getAll('versions');
    expect(remainingVersions).toHaveLength(1);
    expect(remainingVersions[0]?.content).toBe('Important guest content');
    expect(remainingVersions[0]?.guestId).toBe(GUEST_ID);
  });

  it('Requirement 3 (draft): failed write to user drafts leaves guest draft in guestDb untouched', async () => {
    const guestDb = await getLocalDb('justwriting-local');
    await guestDb.put('drafts', {
      userId: 'guest_draft',
      title: 'Draft',
      content: 'Unsaved draft text',
      seconds: 10,
      wpm: 50,
      wordCount: 3,
      updatedAt: Date.now(),
    });
    localStorage.setItem(STORAGE_KEYS.GUEST_DRAFT, 'Unsaved draft text');

    const userDb = await getLocalDb(USER_ID);
    const origPut = userDb.put.bind(userDb);
    vi.spyOn(userDb, 'put').mockImplementation(async (storeName: any, ...rest: any[]) => {
      if (storeName === 'drafts') {
        throw new Error('DRAFT_PUT_FAILED');
      }
      return (origPut as any)(storeName, ...rest);
    });

    await expect(migrateDocuments(USER_ID)).rejects.toThrow('DRAFT_PUT_FAILED');

    // Guest draft MUST NOT be deleted
    const guestDraft = await guestDb.get('drafts', 'guest_draft');
    expect(guestDraft).toBeDefined();
    expect(guestDraft?.content).toBe('Unsaved draft text');
    expect(localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT)).toBe('Unsaved draft text');
  });

  it('Requirement 4: second call to migrateDocuments is idempotent — returns 0, no errors, no duplicate documents or versions', async () => {
    const docId = await LocalDocumentService.createDocument(GUEST_ID, {
      title: 'Idempotency Note',
    });
    await LocalVersionService.addVersion(GUEST_ID, docId, {
      content: 'Single version',
      previousContent: '',
      wordCount: 2,
      duration: 10,
      wpm: 12,
      versionNumber: 1,
      sessionStartedAt: new Date(),
    });

    // 1st run
    const res1 = await migrateDocuments(USER_ID);
    expect(res1.moved).toBe(1);

    // 2nd run
    const res2 = await migrateDocuments(USER_ID);
    expect(res2.moved).toBe(0);

    // Verify user database has exactly 1 doc and 1 version (no duplicates)
    const userDb = await getLocalDb(USER_ID);
    const docs = await userDb.getAll('documents');
    expect(docs).toHaveLength(1);
    expect(docs[0]?.id).toBe(docId);

    const versions = await userDb.getAll('versions');
    expect(versions).toHaveLength(1);
    expect(versions[0]?.content).toBe('Single version');
  });

  it('Sign-out with wipe leaves ZERO guest-account text in justwriting-local', async () => {
    // 1. Guest writes notes and draft
    const docId = await LocalDocumentService.createDocument(GUEST_ID, {
      title: 'Secret Life Diary',
    });
    await LocalVersionService.addVersion(GUEST_ID, docId, {
      content: 'Very sensitive diary entry',
      previousContent: '',
      wordCount: 4,
      duration: 30,
      wpm: 8,
      versionNumber: 1,
      sessionStartedAt: new Date(),
    });

    const guestDb = await getLocalDb('justwriting-local');
    await guestDb.put('drafts', {
      userId: 'guest_draft',
      title: 'Draft',
      content: 'Sensitive draft',
      seconds: 10,
      wpm: 50,
      wordCount: 2,
      updatedAt: Date.now(),
    });

    // 2. User logs in & migrates
    mockCurrentUser = { uid: USER_ID, email: 'user@example.com' };
    await migrateDocuments(USER_ID);

    // Verify immediately after migration: justwriting-local is already clean
    let guestDocs = await guestDb.getAll('documents');
    let guestVersions = await guestDb.getAll('versions');
    expect(guestDocs).toHaveLength(0);
    expect(guestVersions).toHaveLength(0);

    // 3. User signs out with clearLocalData: true
    await AuthService.signOut({ clearLocalData: true, force: true });

    // 4. Inspect justwriting-local after signOut: completely free of sensitive content
    const reloadedGuestDb = await getLocalDb('justwriting-local');
    for (const store of ['documents', 'versions', 'drafts', 'profile'] as const) {
      const records = await reloadedGuestDb.getAll(store);
      const dumped = JSON.stringify(records);
      expect(dumped).not.toContain('Secret Life Diary');
      expect(dumped).not.toContain('Very sensitive diary entry');
      expect(dumped).not.toContain('Sensitive draft');
      expect(dumped).not.toContain(USER_ID);
    }
  });
});
