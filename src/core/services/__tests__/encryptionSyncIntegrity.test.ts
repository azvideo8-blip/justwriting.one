import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { CloudSyncService } from '../CloudSyncService';
import { DocumentService } from '../DocumentService';
import { LocalStorageService } from '../LocalStorageService';
import { LocalVersionService } from '../LocalVersionService';
import { VersionService } from '../VersionService';
import { ConflictResolver } from '../ConflictResolver';
import { getLocalDb } from '../../storage/localDb';
import { setEncryptionEnabled, setProfileLoaded, maybeEncrypt } from '../../crypto/cryptoHelpers';
import { setSessionKey, clearSessionKey } from '../../crypto/encrypt';

describe('AG-CORRUPT-1 & AG-CORRUPT-2: Encryption sync integrity', () => {
  const userId = 'user_enc_integrity';
  let mockKey: CryptoKey;

  beforeEach(async () => {
    vi.resetAllMocks();
    localStorage.clear();
    setProfileLoaded(userId, true);
    setEncryptionEnabled(userId, true);

    mockKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
    setSessionKey(mockKey);

    const db = await getLocalDb(userId);
    const tx = db.transaction(['documents', 'versions', 'syncQueue'], 'readwrite');
    await Promise.all([
      tx.objectStore('documents').clear(),
      tx.objectStore('versions').clear(),
      tx.objectStore('syncQueue').clear(),
      tx.done,
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearSessionKey();
  });

  it('AG-CORRUPT-1: VersionService.addVersion preserves precomputed wordsAdded & charsAdded rather than recomputing on ciphertext', async () => {
    const dataProviderAddSpy = vi.fn();
    const { DataProvider } = await import('../../data');
    vi.spyOn(DataProvider, 'addVersion').mockImplementation(dataProviderAddSpy);

    const plaintext = 'Синтетический текст заметки';
    const encrypted = await maybeEncrypt({ content: plaintext, previousContent: '' }, ['content', 'previousContent'], [], userId);

    await VersionService.addVersion(userId, 'cloud_doc_1', {
      content: encrypted.content as string,
      previousContent: '',
      wordCount: 3,
      wordsAdded: 3,
      charsAdded: 27,
      duration: 10,
      wpm: 18,
      versionNumber: 1,
      sessionStartedAt: new Date(),
      _encrypted: true,
    });

    expect(dataProviderAddSpy).toHaveBeenCalled();
    const savedDoc = dataProviderAddSpy.mock.calls[0]![3] as Record<string, unknown>;
    expect(savedDoc.wordsAdded).toBe(3);
    expect(savedDoc.charsAdded).toBe(27);
  });

  it('AG-CORRUPT-2: addCloudCopy reconciles encrypted cloud version without false collision and without forking', async () => {
    const conflictSpy = vi.spyOn(ConflictResolver, 'resolveConflict');

    // 1. Create local document and version (plaintext)
    const localId = await LocalStorageService.createDocument(userId, {
      title: 'Секретная заметка',
      tags: [],
    });
    const plaintext = 'Строка один два три';
    await LocalVersionService.addVersion(userId, localId, {
      content: plaintext,
      previousContent: '',
      wordCount: 4,
      duration: 10,
      wpm: 24,
      versionNumber: 1,
      sessionStartedAt: new Date(),
    });

    const cloudDocId = 'cloud_doc_enc_1';
    await LocalStorageService.updateLinkedCloudId(localId, cloudDocId, userId);

    // 2. Encrypt the same content as stored in cloud
    const encrypted = await maybeEncrypt({ content: plaintext }, ['content'], [], userId);

    vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockResolvedValue({
      id: cloudDocId,
      title: 'Секретная заметка',
      currentVersion: 1,
      totalWords: 4,
      totalDuration: 10,
      sessionsCount: 1,
      firstSessionAt: new Date(),
      lastSessionAt: new Date(),
    } as any);

    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([
      {
        id: 'v1',
        documentId: cloudDocId,
        version: 1,
        content: encrypted.content as string,
        wordCount: 4,
        duration: 10,
        wpm: 24,
        wordsAdded: 4,
        charsAdded: 19,
        goalReached: false,
        savedAt: new Date(),
        sessionStartedAt: new Date(),
        _encrypted: true,
      } as any,
    ]);

    vi.spyOn(DocumentService, 'updateDocumentAfterSession').mockResolvedValue(undefined as any);

    // Reconcile via addCloudCopy
    await CloudSyncService.addCloudCopy(userId, localId);

    // Must NOT detect a conflict or fork the note!
    expect(conflictSpy).not.toHaveBeenCalled();
  });
});
