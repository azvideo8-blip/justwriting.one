import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { CloudSyncService } from '../CloudSyncService';
import { DocumentService } from '../DocumentService';
import { VersionService } from '../VersionService';
import { LocalStorageService } from '../LocalStorageService';
import { LocalVersionService } from '../LocalVersionService';
import * as CryptoHelpers from '../../crypto/cryptoHelpers';

vi.mock('../../firebase/firestore', () => ({ isFirestoreConnected: true }));

const CIPHERTEXT = 'k7Hs9x2fQ0aZ==';

const cloudVersion = (v: number) => ({
  id: `v${v}`, version: v, content: CIPHERTEXT, wordCount: 1,
  duration: 0, wpm: 0, savedAt: 1, sessionStartedAt: 1, _encrypted: true,
});

// The local store holds plaintext. Writing `ver.content` after a failed decrypt
// put Base64 ciphertext there, and the note became gibberish the app could not
// tell from real writing.
describe('addLocalCopy — a failed decrypt never becomes local text', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(LocalStorageService, 'getGuestDocuments').mockResolvedValue([]);
    vi.spyOn(LocalStorageService, 'createDocument').mockResolvedValue('local_new');
    vi.spyOn(LocalStorageService, 'updateDocument').mockResolvedValue(undefined as never);
    vi.spyOn(LocalStorageService, 'updateLinkedCloudId').mockResolvedValue(undefined);
    vi.spyOn(LocalStorageService, 'deleteDocument').mockResolvedValue(undefined as never);
    vi.spyOn(DocumentService, 'getDocument').mockResolvedValue({
      id: 'cloud_1', title: 'n', tags: [], totalWords: 1, totalDuration: 0,
      currentVersion: 2, sessionsCount: 1, firstSessionAt: new Date(1), lastSessionAt: new Date(2),
    } as never);
  });

  afterEach(() => vi.restoreAllMocks());

  it('skips an unreadable older version instead of storing its ciphertext', async () => {
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([cloudVersion(1), cloudVersion(2)] as never);
    vi.spyOn(CryptoHelpers, 'maybeDecrypt').mockImplementation(async (doc) => {
      if ((doc as { version?: number }).version === 1) throw new CryptoHelpers.DecryptionError('content');
      return { ...(doc as object), content: 'настоящий текст' } as never;
    });
    const addVersion = vi.spyOn(LocalVersionService, 'addVersion').mockResolvedValue(undefined as never);

    await CloudSyncService.addLocalCopy('user_1', 'cloud_1');

    expect(addVersion).toHaveBeenCalledTimes(1);
    const written = addVersion.mock.calls.map(c => (c[2] as { content: string }).content);
    expect(written).toEqual(['настоящий текст']);
    expect(written.join()).not.toContain(CIPHERTEXT);
  });

  it('aborts the whole import when the NEWEST version cannot be read', async () => {
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([cloudVersion(1), cloudVersion(2)] as never);
    vi.spyOn(CryptoHelpers, 'maybeDecrypt').mockImplementation(async (doc) => {
      if ((doc as { version?: number }).version === 2) throw new CryptoHelpers.DecryptionError('content');
      return { ...(doc as object), content: 'старый текст' } as never;
    });
    vi.spyOn(LocalVersionService, 'addVersion').mockResolvedValue(undefined as never);
    const removePartial = vi.spyOn(LocalStorageService, 'deleteDocument').mockResolvedValue(undefined as never);

    await expect(CloudSyncService.addLocalCopy('user_1', 'cloud_1')).rejects.toThrow(/DECRYPT_FAILED_LATEST/);
    // The half-built local note must not stay behind showing older text as current.
    expect(removePartial).toHaveBeenCalledWith('local_new');
  });

  it('treats a non-string payload as corrupt rather than falling back to the raw field', async () => {
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([cloudVersion(1)] as never);
    vi.spyOn(CryptoHelpers, 'maybeDecrypt').mockResolvedValue({ content: { not: 'a string' } } as never);
    vi.spyOn(LocalVersionService, 'addVersion').mockResolvedValue(undefined as never);

    await expect(CloudSyncService.addLocalCopy('user_1', 'cloud_1')).rejects.toThrow(/DECRYPT_FAILED_LATEST/);
  });

  it('still rethrows LOCKED untouched — a locked vault is not corruption', async () => {
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([cloudVersion(1)] as never);
    vi.spyOn(CryptoHelpers, 'maybeDecrypt').mockRejectedValue(new Error('LOCKED: session key not available'));
    vi.spyOn(LocalVersionService, 'addVersion').mockResolvedValue(undefined as never);

    await expect(CloudSyncService.addLocalCopy('user_1', 'cloud_1')).rejects.toThrow(/LOCKED/);
  });
});
