import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetDbInstance, getLocalDb } from '../../../../shared/lib/localDb';
import { SyncService } from '../SyncService';
import { StorageService } from '../StorageService';
import { SessionService } from '../SessionService';

vi.mock('../StorageService', () => ({
  StorageService: {
    addCloudCopy: vi.fn(async () => 'mocked_cloud_id'),
  }
}));

vi.mock('../SessionService', () => ({
  SessionService: {
    deleteSession: vi.fn(async () => {}),
  }
}));

vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  maybeDecrypt: vi.fn(async (doc: Record<string, unknown>) => ({ ...doc, _encrypted: false })),
}));

describe('SyncService.migrateLegacySession', () => {
  const userId = 'user_test_123';
  const legacySession = {
    id: 'legacy_sess_999',
    userId,
    title: 'Legacy Note',
    content: 'Decrypted legacy content',
    wordCount: 3,
    duration: 60,
    wpm: 3,
    createdAt: new Date('2025-01-01T12:00:00Z'),
  };

  beforeEach(async () => {
    resetDbInstance();
    vi.clearAllMocks();

    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase('justwriting-local');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });

  it('migrates a regular unencrypted legacy session successfully', async () => {
    await SyncService.migrateLegacySession(userId, legacySession as any, false);

    // Verify document in IndexedDB
    const db = await getLocalDb();
    const docs = await db.getAll('documents');
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe('Legacy Note');
    expect(docs[0].totalWords).toBe(3);
    expect(docs[0].guestId).toBe(userId);

    // Verify version in IndexedDB
    const versions = await db.getAll('versions');
    expect(versions).toHaveLength(1);
    expect(versions[0].documentId).toBe(docs[0].id);
    expect(versions[0].content).toBe('Decrypted legacy content');

    // Verify Cloud Copy was added
    expect(StorageService.addCloudCopy).toHaveBeenCalledWith(userId, docs[0].id, false);

    // Verify Legacy Session was deleted
    expect(SessionService.deleteSession).toHaveBeenCalledWith('legacy_sess_999');
  });

  it('fails if the session is locked or has decryption error', async () => {
    const lockedSession = { ...legacySession, _locked: true };
    await expect(
      SyncService.migrateLegacySession(userId, lockedSession as any, false)
    ).rejects.toThrow('Cannot migrate encrypted session without unlocking vault');

    const errSession = { ...legacySession, _decryptionError: true };
    await expect(
      SyncService.migrateLegacySession(userId, errSession as any, false)
    ).rejects.toThrow('Cannot migrate encrypted session without unlocking vault');
  });

  it('rolls back IndexedDB transactions if Cloud sync fails', async () => {
    vi.mocked(StorageService.addCloudCopy).mockRejectedValueOnce(new Error('Cloud Fail'));

    await expect(
      SyncService.migrateLegacySession(userId, legacySession as any, false)
    ).rejects.toThrow('Cloud Fail');

    // Verify rollback
    const db = await getLocalDb();
    const docs = await db.getAll('documents');
    expect(docs).toHaveLength(0);
    const versions = await db.getAll('versions');
    expect(versions).toHaveLength(0);

    // Legacy session should not be deleted
    expect(SessionService.deleteSession).not.toHaveBeenCalled();
  });
});
