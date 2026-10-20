import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { WritingDraftService } from '../WritingDraftService';
import { setEncryptionEnabled, setProfileLoaded } from '../../../../core/crypto/cryptoHelpers';
import { generateDataKey, setSessionKey, clearSessionKey } from '../../../../core/crypto/encrypt';
import { DataProvider } from '../../../../core/data';
import { DRAFT_FIELDS } from '../../../../core/data/providers/fields';

describe('LIFE-2: Draft tags encryption & field classification', () => {
  const userId = 'user_draft_test';

  beforeEach(() => {
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED('user_draft_test'), 'true'); // D-22: эти тесты проверяют облачную запись
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearSessionKey();
    setEncryptionEnabled(userId, false);
    setProfileLoaded(userId, false);
  });

  it('With the vault on, draft tags are encrypted before reaching DataProvider', async () => {
    const key = await generateDataKey();
    setSessionKey(key);
    setEncryptionEnabled(userId, true);
    setProfileLoaded(userId, true);

    let savedPayload: Record<string, unknown> | null = null;
    vi.spyOn(DataProvider, "saveDraft").mockImplementation(async (_uid, payload) => {
      savedPayload = payload;
      return null;
    });

    const draft = {
      userId,
      title: 'Secret Draft Title',
      content: 'Secret Draft Content',
      tags: ['secret-tag-1', 'private-thoughts'],
      pinnedThoughts: ['pinned thought'],
      wordCount: 10,
      seconds: 60,
      wpm: 20,
      initialWordCount: 0,
      accumulatedDuration: 60,
      totalPauseSeconds: 0,
      updatedAt: Date.now(),
    };

    const ok = await WritingDraftService.saveDraftToCloud(draft as never);
    expect(ok).toBe(true);
    expect(savedPayload).not.toBeNull();

    // tags must NOT be readable as plain text array
    expect(savedPayload!._encrypted).toBe(true);
    expect(savedPayload!.tags).not.toEqual(['secret-tag-1', 'private-thoughts']);
    expect(typeof savedPayload!.tags).toBe('string'); // Encrypted string
    expect(String(savedPayload!.tags)).not.toContain('secret-tag-1');
    expect(String(savedPayload!.tags)).not.toContain('private-thoughts');

    // Title and content must also be encrypted
    expect(savedPayload!.title).not.toBe('Secret Draft Title');
    expect(savedPayload!.content).not.toBe('Secret Draft Content');

    // Test loadDraft round-trip decryption
    vi.spyOn(DataProvider, 'getDraft').mockResolvedValue({ userId, ...savedPayload! });
    const loaded = await WritingDraftService.loadDraft(userId);
    expect(loaded?.tags).toEqual(['secret-tag-1', 'private-thoughts']);
    expect(loaded?.title).toBe('Secret Draft Title');
    expect(loaded?.content).toBe('Secret Draft Content');
  });

  it('Field-inventory test: all fields reaching drafts table are classified', () => {
    const ENCRYPTED_FIELDS = new Set(['content', 'title', 'tags', 'pinnedThoughts']);
    const METADATA_FIELDS = new Set([
      'userId',
      'seconds',
      'wpm',
      'wordCount',
      'initialWordCount',
      'activeSessionId',
      'sessionStartTime',
      'accumulatedDuration',
      'totalPauseSeconds',
      'savedDocumentId',
      'labelId',
      'updatedAt',
      '_encrypted',
    ]);

    const allDraftCols = Object.keys(DRAFT_FIELDS);
    const unclassified: string[] = [];

    for (const field of allDraftCols) {
      if (!ENCRYPTED_FIELDS.has(field) && !METADATA_FIELDS.has(field)) {
        unclassified.push(field);
      }
    }

    expect(unclassified).toEqual([]);
  });
});
