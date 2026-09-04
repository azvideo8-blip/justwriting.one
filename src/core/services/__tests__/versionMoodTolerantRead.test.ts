import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  maybeDecrypt,
  VALID_MOOD_EMOJIS,
  DecryptionError,
  setEncryptionEnabled,
  setProfileLoaded,
} from '../../../core/crypto/cryptoHelpers';
import { generateDataKey, setSessionKey, clearSessionKey, encryptContent, decryptContent } from '../../../core/crypto/encrypt';
import { getLocalDb } from '../../../core/storage/localDb';
import { CloudSyncService } from '../CloudSyncService';
import { LocalVersionService } from '../LocalVersionService';
import { LocalStorageService } from '../LocalStorageService';
import { FaultInterceptor } from '../../../testing/faultHarness/faultInterceptor';
import * as authModule from '../../../core/auth';
import { StorageService } from '../StorageService';
import { encryptAllExistingNotes } from '../../../core/crypto/encryptMigration';
import fs from 'node:fs';
import path from 'node:path';

describe('AG-ENC-1: versions.mood Tolerant Read, Write Encryption & Backfill Tests', () => {
  const userId = 'user_tolerant_mood_test';
  let interceptor: FaultInterceptor;

  beforeEach(async () => {
    vi.restoreAllMocks();
    interceptor = new FaultInterceptor();
    interceptor.installMocks();

    vi.spyOn(authModule, 'getCurrentUser').mockReturnValue({
      uid: userId,
      email: 'test@example.com',
    } as any);

    setProfileLoaded(userId, true);

    const db = await getLocalDb();
    await db.clear('documents');
    await db.clear('versions');
    await db.clear('syncQueue');
  });

  afterEach(async () => {
    interceptor.uninstallMocks();
    clearSessionKey();
    setEncryptionEnabled(userId, false);
    setProfileLoaded(userId, false);
    const db = await getLocalDb();
    await db.clear('documents');
    await db.clear('versions');
    await db.clear('syncQueue');
  });

  it('Test 1 (The one that matters): a version row shaped by old code (_encrypted: true, mood: "😊") is read without throwing', async () => {
    const key = await generateDataKey();
    setSessionKey(key);
    setEncryptionEnabled(userId, true);

    const encryptedContent = await encryptContent('Secret session text', key);

    // Old code shape: _encrypted: true, content is ciphertext, BUT mood is plaintext emoji
    const oldVersionRow = {
      _encrypted: true,
      content: encryptedContent,
      mood: '😊',
      version: 1,
    };

    // 1. Direct maybeDecrypt tolerance
    const decrypted = await maybeDecrypt(oldVersionRow, ['content', 'mood'], []);
    expect(decrypted.content).toBe('Secret session text');
    expect(decrypted.mood).toBe('😊');

    // 2. All 6 valid emojis are tolerated on old rows
    for (const emoji of VALID_MOOD_EMOJIS) {
      const row = { _encrypted: true, content: encryptedContent, mood: emoji };
      const res = await maybeDecrypt(row, ['content', 'mood'], []);
      expect(res.mood).toBe(emoji);
    }
  });

  it('tolerant read throws DecryptionError on corrupt or non-emoji mood on encrypted row', async () => {
    const key = await generateDataKey();
    setSessionKey(key);
    setEncryptionEnabled(userId, true);

    const encryptedContent = await encryptContent('Secret session text', key);

    // Corrupt ciphertext that is NOT one of the 6 emojis
    const corruptRow = {
      _encrypted: true,
      content: encryptedContent,
      mood: 'corrupt_non_emoji_payload_that_fails_decryption',
      version: 1,
    };

    await expect(maybeDecrypt(corruptRow, ['content', 'mood'], [])).rejects.toThrow(DecryptionError);
  });

  it('Test 4: ciphertext for mood exceeds 50 characters and fits within 2000 characters', async () => {
    const key = await generateDataKey();

    // A mood string valid under the schema constraint (which allowed up to 50 chars)
    // or with descriptive notes produces ciphertext that strictly exceeds 50 chars:
    const ciphertextLongMood = await encryptContent('feeling thoughtful today', key);
    expect(ciphertextLongMood.length).toBeGreaterThan(50);
    expect(ciphertextLongMood.length).toBeLessThanOrEqual(2000);

    // Single emoji ciphertext is 44 characters (which would overflow if slightly longer):
    const emojiCiphertext = await encryptContent('😊', key);
    expect(emojiCiphertext.length).toBeLessThanOrEqual(2000);

    // Check that the migration file dropped the 50 char constraint and added 2000 char constraint
    const migrationFile = path.resolve(process.cwd(), 'supabase/migrations/0023_encrypt_versions_mood.sql');
    expect(fs.existsSync(migrationFile)).toBe(true);
    const sql = fs.readFileSync(migrationFile, 'utf8');
    expect(sql).toContain('length(mood) <= 2000');
  });

  it('end-to-end: addLocalCopy successfully restores old-format cloud version with plaintext mood', async () => {
    const key = await generateDataKey();
    setSessionKey(key);
    setEncryptionEnabled(userId, true);

    const cloudDocId = 'cloud_doc_old_version';
    const encryptedTitle = await encryptContent('Old Note Title', key);
    const encryptedContent = await encryptContent('Old version text', key);

    // Insert old format note into Postgres mock
    interceptor.postgres.executeInsert('documents', {
      uuid: cloudDocId,
      user_id: userId,
      title: encryptedTitle,
      current_version: 1,
      total_words: 3,
      total_duration: 20,
      _encrypted: true,
      first_session_at: new Date(1000).toISOString(),
      last_session_at: new Date(1000).toISOString(),
    });

    // Version written by old code: _encrypted: true, content encrypted, mood plaintext
    interceptor.postgres.executeInsert('versions', {
      document_uuid: cloudDocId,
      user_id: userId,
      version: 1,
      content: encryptedContent,
      word_count: 3,
      duration: 20,
      wpm: 12,
      saved_at: new Date(1000).toISOString(),
      session_started_at: new Date(1000).toISOString(),
      mood: '🤔',
      _encrypted: true,
    });

    // addLocalCopy pulls down the note and its versions
    const localId = await CloudSyncService.addLocalCopy(userId, cloudDocId);
    expect(localId).toBeDefined();

    const localVersions = await LocalVersionService.getVersions(localId);
    expect(localVersions).toHaveLength(1);
    expect(localVersions[0]!.content).toBe('Old version text');
    expect(localVersions[0]!.mood).toBe('🤔');
  });

  it('Test 2: write version with vault enabled encrypts versions.mood in cloud and decrypts on read', async () => {
    const key = await generateDataKey();
    setSessionKey(key);
    setEncryptionEnabled(userId, true);

    const docId = await LocalStorageService.createDocument(userId, {
      title: 'Secret Mood Note',
      tags: ['mood-test'],
      firstSessionAt: 1000,
      lastSessionAt: 1000,
    });

    await StorageService.saveVersion(userId, docId, {
      title: 'Secret Mood Note',
      content: 'Hello world',
      wordCount: 2,
      duration: 30,
      wpm: 4,
      sessionStartedAt: new Date(1000),
      tags: ['mood-test'],
      mood: '😊',
    });

    const cloudId = await CloudSyncService.addCloudCopy(userId, docId);
    expect(cloudId).toBeTruthy();

    const cloudVersions = interceptor.postgres.getRows('versions').filter(v => v.document_uuid === cloudId);
    expect(cloudVersions.length).toBeGreaterThan(0);
    const cloudVer = cloudVersions[0]!;
    expect(cloudVer._encrypted).toBe(true);
    // mood in Postgres MUST be ciphertext, NOT plaintext emoji
    expect(cloudVer.mood).not.toBe('😊');
    expect(typeof cloudVer.mood).toBe('string');
    expect(await decryptContent(cloudVer.mood as string, key)).toBe('😊');

    // Read back via addLocalCopy on clean local db
    const localDb = await getLocalDb();
    await localDb.clear('documents');
    await localDb.clear('versions');

    const restoredLocalId = await CloudSyncService.addLocalCopy(userId, cloudId);
    expect(restoredLocalId).toBeTruthy();

    const restoredVersions = await LocalVersionService.getVersions(restoredLocalId);
    expect(restoredVersions).toHaveLength(1);
    expect(restoredVersions[0]!.mood).toBe('😊');
    expect(restoredVersions[0]!.content).toBe('Hello world');
  });

  it('Test 3: encryptAllExistingNotes backfills unencrypted mood on legacy versions without double-encrypting content', async () => {
    const key = await generateDataKey();
    setSessionKey(key);
    setEncryptionEnabled(userId, true);

    const docLegacyPlain = 'doc_legacy_plain';
    const docLegacyEncrypted = 'doc_legacy_vault';
    const encryptedContent = await encryptContent('Already encrypted content', key);
    const encryptedDocTitle = await encryptContent('Encrypted Doc', key);

    // Legacy unencrypted document & version
    interceptor.postgres.executeInsert('documents', {
      uuid: docLegacyPlain,
      user_id: userId,
      title: 'Plain Doc',
      current_version: 1,
      total_words: 2,
      total_duration: 30,
      first_session_at: new Date(1000).toISOString(),
      last_session_at: new Date(1000).toISOString(),
      _encrypted: false,
    });
    interceptor.postgres.executeInsert('versions', {
      document_uuid: docLegacyPlain,
      user_id: userId,
      version: 1,
      content: 'Plain content',
      mood: '😊',
      word_count: 2,
      duration: 20,
      wpm: 10,
      saved_at: new Date(1000).toISOString(),
      session_started_at: new Date(1000).toISOString(),
      _encrypted: false,
    });

    // Legacy vault document & version (content was encrypted by old code, but mood was left plaintext)
    interceptor.postgres.executeInsert('documents', {
      uuid: docLegacyEncrypted,
      user_id: userId,
      title: encryptedDocTitle,
      current_version: 1,
      total_words: 3,
      total_duration: 40,
      first_session_at: new Date(1000).toISOString(),
      last_session_at: new Date(1000).toISOString(),
      _encrypted: true,
    });
    interceptor.postgres.executeInsert('versions', {
      document_uuid: docLegacyEncrypted,
      user_id: userId,
      version: 1,
      content: encryptedContent,
      mood: '😢',
      word_count: 3,
      duration: 30,
      wpm: 10,
      saved_at: new Date(1000).toISOString(),
      session_started_at: new Date(1000).toISOString(),
      _encrypted: true,
    });

    // Run backfill migration
    const progress = await encryptAllExistingNotes(userId);
    expect(progress.errors).toBe(0);

    const rows = interceptor.postgres.getRows('versions');
    const ver1 = rows.find(v => v.document_uuid === docLegacyPlain);
    const ver2 = rows.find(v => v.document_uuid === docLegacyEncrypted);

    expect(ver1?._encrypted).toBe(true);
    expect(ver1?.mood).not.toBe('😊');
    expect(await decryptContent(ver1?.mood as string, key)).toBe('😊');

    expect(ver2?._encrypted).toBe(true);
    expect(ver2?.mood).not.toBe('😢');
    expect(await decryptContent(ver2?.mood as string, key)).toBe('😢');
    // ver2 content was NOT double encrypted
    expect(ver2?.content).toBe(encryptedContent);

    // Read both back via addLocalCopy
    const localDb = await getLocalDb();
    await localDb.clear('documents');
    await localDb.clear('versions');

    const restored1 = await CloudSyncService.addLocalCopy(userId, docLegacyPlain);
    const restored2 = await CloudSyncService.addLocalCopy(userId, docLegacyEncrypted);

    const v1Restored = await LocalVersionService.getVersions(restored1);
    expect(v1Restored[0]!.mood).toBe('😊');
    expect(v1Restored[0]!.content).toBe('Plain content');

    const v2Restored = await LocalVersionService.getVersions(restored2);
    expect(v2Restored[0]!.mood).toBe('😢');
    expect(v2Restored[0]!.content).toBe('Already encrypted content');
  });
});

