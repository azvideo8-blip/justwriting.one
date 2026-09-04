import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  maybeDecrypt,
  VALID_MOOD_EMOJIS,
  DecryptionError,
  setEncryptionEnabled,
} from '../../../core/crypto/cryptoHelpers';
import { generateDataKey, setSessionKey, clearSessionKey, encryptContent } from '../../../core/crypto/encrypt';
import { getLocalDb } from '../../../core/storage/localDb';
import { CloudSyncService } from '../CloudSyncService';
import { LocalVersionService } from '../LocalVersionService';
import { FaultInterceptor } from '../../../testing/faultHarness/faultInterceptor';
import * as authModule from '../../../core/auth';
import fs from 'node:fs';
import path from 'node:path';

describe('AG-ENC-1: versions.mood Tolerant Read & Constraint Tests (Release 1)', () => {
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

    const db = await getLocalDb();
    await db.clear('documents');
    await db.clear('versions');
    await db.clear('syncQueue');
  });

  afterEach(async () => {
    interceptor.uninstallMocks();
    clearSessionKey();
    setEncryptionEnabled(userId, false);
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
});
