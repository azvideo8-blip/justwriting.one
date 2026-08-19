import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';
import {
  LocalStoreSyncService,
  SUPPORTED_LOCAL_STORES,
  MAX_LOCAL_RECORD_BYTES,
  getOversizedRecordCount,
  extractRecordTimestamp,
} from '../LocalStoreSyncService';

const mockSaveRecord = vi.fn();
const mockDeleteRecord = vi.fn();
const mockGetRecords = vi.fn();

vi.mock('../../data', () => ({
  DataProvider: {
    saveLocalStoreRecord: (...args: unknown[]) => mockSaveRecord(...args),
    deleteLocalStoreRecord: (...args: unknown[]) => mockDeleteRecord(...args),
    getLocalStoreRecords: (...args: unknown[]) => mockGetRecords(...args),
  },
}));

let mockUser: { uid: string } | null = { uid: 'test_user_123' };
vi.mock('../../auth', () => ({
  getCurrentUser: () => mockUser,
}));

let mockSessionKey: CryptoKey | null = {} as CryptoKey;
vi.mock('../../crypto/encrypt', () => ({
  getSessionKey: () => mockSessionKey,
}));

let mockEncryptionEnabled = true;
vi.mock('../../crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => mockEncryptionEnabled,
  maybeEncrypt: vi.fn(async (payload: Record<string, unknown>) => {
    if (mockEncryptionEnabled && !mockSessionKey) {
      throw new Error('ENCRYPT_REQUIRED: session key not available');
    }
    return {
      ...payload,
      data: `ENCRYPTED(${payload.data as string})`,
      _encrypted: true,
    };
  }),
  maybeDecrypt: vi.fn(async (payload: Record<string, unknown>) => {
    const raw = payload.data as string;
    const decrypted = raw.startsWith('ENCRYPTED(') && raw.endsWith(')')
      ? raw.slice(10, -1)
      : raw;
    return { ...payload, data: decrypted };
  }),
}));

describe('LocalStoreSyncService', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockUser = { uid: 'test_user_123' };
    mockSessionKey = {} as CryptoKey;
    mockEncryptionEnabled = true;
    localStorage.clear();
    const db = await getLocalDb();
    for (const store of SUPPORTED_LOCAL_STORES) {
      if (db.objectStoreNames.contains(store)) {
        await db.clear(store);
      }
    }
  });

  it('contains exactly the 13 supported AI stores', () => {
    expect(SUPPORTED_LOCAL_STORES).toHaveLength(13);
    expect(SUPPORTED_LOCAL_STORES).toContain('aiPortrait');
    expect(SUPPORTED_LOCAL_STORES).toContain('aiProfileFacets');
    expect(SUPPORTED_LOCAL_STORES).toContain('aiDialogues');
    expect(SUPPORTED_LOCAL_STORES).toContain('aiDialogueEvents');
    expect(SUPPORTED_LOCAL_STORES).toContain('aiChatMemory');
    expect(SUPPORTED_LOCAL_STORES).toContain('lifeStory');
    expect(SUPPORTED_LOCAL_STORES).toContain('aiThemeLedger');
    expect(SUPPORTED_LOCAL_STORES).toContain('aiTimeline');
    expect(SUPPORTED_LOCAL_STORES).toContain('aiBeliefs');
    expect(SUPPORTED_LOCAL_STORES).toContain('aiCommitments');
    expect(SUPPORTED_LOCAL_STORES).toContain('aiMonthlyDigest');
    expect(SUPPORTED_LOCAL_STORES).toContain('aiThreads');
    expect(SUPPORTED_LOCAL_STORES).toContain('aiPersonas');
  });

  it('extractRecordTimestamp correctly parses multiple timestamp formats', () => {
    expect(extractRecordTimestamp({ updatedAt: 123456789 })).toBe(123456789);
    expect(extractRecordTimestamp({ lastReinforcedAt: '2026-08-19' })).toBe(Date.parse('2026-08-19'));
    expect(extractRecordTimestamp({ generatedAt: 987654321 })).toBe(987654321);
    expect(extractRecordTimestamp({ createdAt: 1122334455 })).toBe(1122334455);
    expect(extractRecordTimestamp({ date: '2026-08-15' })).toBe(Date.parse('2026-08-15'));
    expect(extractRecordTimestamp({ firstSeenAt: '2026-08-01' })).toBe(Date.parse('2026-08-01'));
    expect(extractRecordTimestamp({})).toBeNull();
    expect(extractRecordTimestamp(null)).toBeNull();
  });

  it('encrypts payload and uploads to DataProvider on flushPending', async () => {
    const db = await getLocalDb();
    await db.put('aiPortrait', { id: 'singleton', portrait: '# Test Portrait', updatedAt: 1000, generatedAtDelta: 0 });

    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'singleton');
    const res = await LocalStoreSyncService.flushPending();

    expect(res.synced).toBe(1);
    expect(res.failed).toBe(0);
    expect(mockSaveRecord).toHaveBeenCalledWith(
      'test_user_123',
      'aiPortrait',
      'singleton',
      expect.objectContaining({
        _encrypted: true,
        data: expect.stringContaining('ENCRYPTED('),
      }),
    );
  });

  it('debounces 5 rapid writes into a single batch flush', async () => {
    const db = await getLocalDb();
    await db.put('aiDialogues', {
      id: 'd1',
      title: 'Chat 1',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      personaId: 'default',
      personaName: 'Assistant',
      personaEmoji: '🤖',
    });

    // 5 rapid schedules for the same item
    LocalStoreSyncService.scheduleStoreSync('aiDialogues', 'd1');
    LocalStoreSyncService.scheduleStoreSync('aiDialogues', 'd1');
    LocalStoreSyncService.scheduleStoreSync('aiDialogues', 'd1');
    LocalStoreSyncService.scheduleStoreSync('aiDialogues', 'd1');
    LocalStoreSyncService.scheduleStoreSync('aiDialogues', 'd1');

    const res = await LocalStoreSyncService.flushPending();
    expect(res.synced).toBe(1);
    expect(mockSaveRecord).toHaveBeenCalledTimes(1);
  });

  it('postpones upload when vault is locked and does not leak plaintext', async () => {
    mockSessionKey = null; // Vault locked!

    const db = await getLocalDb();
    await db.put('lifeStory', { eventDate: '2026-08-19', text: 'Private memory', generatedAt: 1000, sourceDocumentIds: [] });

    LocalStoreSyncService.scheduleStoreSync('lifeStory', '2026-08-19');
    const res = await LocalStoreSyncService.flushPending();

    expect(res.skippedLocked).toBe(true);
    expect(res.synced).toBe(0);
    expect(mockSaveRecord).not.toHaveBeenCalled();

    // Now unlock vault
    mockSessionKey = {} as CryptoKey;
    const res2 = await LocalStoreSyncService.flushPending();
    expect(res2.synced).toBe(1);
    expect(mockSaveRecord).toHaveBeenCalledTimes(1);
  });

  it('skips oversized records (>500KB) and tracks them in sync status', async () => {
    const db = await getLocalDb();
    const hugeText = 'x'.repeat(MAX_LOCAL_RECORD_BYTES + 1024);
    await db.put('aiDialogues', {
      id: 'huge_dialogue',
      title: 'Huge',
      messages: [{ role: 'user', content: hugeText }],
      createdAt: 1,
      updatedAt: 1,
      personaId: 'default',
      personaName: 'Assistant',
      personaEmoji: '🤖',
    });

    LocalStoreSyncService.scheduleStoreSync('aiDialogues', 'huge_dialogue');
    const res = await LocalStoreSyncService.flushPending();

    expect(res.skippedOversized).toBe(1);
    expect(res.synced).toBe(0);
    expect(mockSaveRecord).not.toHaveBeenCalled();
    expect(getOversizedRecordCount()).toBe(1);
  });

  it('handles deletion and removes record from cloud', async () => {
    LocalStoreSyncService.scheduleStoreDelete('aiPersonas', 'custom_p1');
    const res = await LocalStoreSyncService.flushPending();

    expect(res.synced).toBe(1);
    expect(mockDeleteRecord).toHaveBeenCalledWith('test_user_123', 'aiPersonas', 'custom_p1');
  });
});
