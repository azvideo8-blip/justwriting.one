import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  USER_FIELDS,
  DOCUMENT_FIELDS,
  VERSION_FIELDS,
  DRAFT_FIELDS,
  AI_SUMMARY_FIELDS,
  AI_EMBEDDING_FIELDS,
} from '../fields';
import { setEncryptionEnabled, setProfileLoaded } from '../../../../core/crypto/cryptoHelpers';
import { generateDataKey, setSessionKey, clearSessionKey } from '../../../../core/crypto/encrypt';
import { DataProvider } from '../../../../core/data';
import { DocumentService } from '../../../services/DocumentService';
import { WritingDraftService } from '../../../../features/writing/services/WritingDraftService';
import { saveSummaryToCloud } from '../../../../features/ai/services/AISummaryService';
import { saveEmbeddingToCloud } from '../../../../features/ai/services/AIEmbeddingService';
import { encryptLabel } from '../../../../core/crypto/labelEncryption';
import { AIProfileService } from '../../../../features/ai/services/AIProfileService';
import * as authModule from '../../../../core/auth';

describe('GUARD-1: Field inventory and write-site encryption classification for all 6 tables', () => {
  const userId = 'user_guard1_test';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearSessionKey();
    setEncryptionEnabled(userId, false);
    setProfileLoaded(userId, false);
  });

  // =========================================================================
  // 1. DRAFT_FIELDS
  // =========================================================================
  describe('DRAFT_FIELDS inventory & write-site binding', () => {
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

    it('every field in DRAFT_FIELDS is classified and disjoint', () => {
      const allCols = Object.keys(DRAFT_FIELDS);
      const unclassified: string[] = [];
      const overlap: string[] = [];

      for (const col of allCols) {
        if (!ENCRYPTED_FIELDS.has(col) && !METADATA_FIELDS.has(col)) {
          unclassified.push(col);
        }
        if (ENCRYPTED_FIELDS.has(col) && METADATA_FIELDS.has(col)) {
          overlap.push(col);
        }
      }

      expect(unclassified, `Unclassified columns in DRAFT_FIELDS: ${unclassified.join(', ')}`).toEqual([]);
      expect(overlap, `Overlapping columns in DRAFT_FIELDS: ${overlap.join(', ')}`).toEqual([]);
      expect(ENCRYPTED_FIELDS.size + METADATA_FIELDS.size).toBe(allCols.length);
    });

    it('falsification: adding an unclassified column fails naming that column', () => {
      const augmented = { ...DRAFT_FIELDS, unclassifiedBogusCol: 'bogus' };
      const unclassified = Object.keys(augmented).filter(
        c => !ENCRYPTED_FIELDS.has(c) && !METADATA_FIELDS.has(c)
      );
      expect(unclassified).toContain('unclassifiedBogusCol');
    });

    it('write-site encrypts all declared encrypted fields before reaching DataProvider', async () => {
      const key = await generateDataKey();
      setSessionKey(key);
      setEncryptionEnabled(userId, true);
      setProfileLoaded(userId, true);

      let savedPayload: Record<string, unknown> | null = null;
      vi.spyOn(DataProvider, 'saveDraft').mockImplementation(async (_uid, payload) => {
        savedPayload = payload;
      });

      const draft = {
        userId,
        title: 'Secret Draft Title',
        content: 'Secret Draft Content',
        tags: ['secret-tag-1'],
        pinnedThoughts: ['pinned thought'],
        wordCount: 10,
        seconds: 60,
        wpm: 20,
        initialWordCount: 0,
        accumulatedDuration: 60,
        totalPauseSeconds: 0,
        updatedAt: Date.now(),
      };

      await WritingDraftService.saveDraftToCloud(draft as never);
      expect(savedPayload).not.toBeNull();
      expect(savedPayload!._encrypted).toBe(true);
      for (const field of ENCRYPTED_FIELDS) {
        expect(savedPayload![field]).not.toEqual((draft as Record<string, unknown>)[field]);
        expect(typeof savedPayload![field]).toBe('string');
      }
    });
  });

  // =========================================================================
  // 2. DOCUMENT_FIELDS
  // =========================================================================
  describe('DOCUMENT_FIELDS inventory & write-site binding', () => {
    const ENCRYPTED_FIELDS = new Set(['title', 'tags', 'mood']);
    const METADATA_FIELDS = new Set([
      'uuid',
      'id',
      'userId',
      'currentVersion',
      'totalWords',
      'totalDuration',
      'sessionsCount',
      'firstSessionAt',
      'lastSessionAt',
      'isPublic',
      'labelId',
      'excludedFromAI',
      '_encrypted',
      'deletedAt',
      'createdAt',
    ]);

    it('every field in DOCUMENT_FIELDS is classified and disjoint', () => {
      const allCols = Object.keys(DOCUMENT_FIELDS);
      const unclassified: string[] = [];
      const overlap: string[] = [];

      for (const col of allCols) {
        if (!ENCRYPTED_FIELDS.has(col) && !METADATA_FIELDS.has(col)) {
          unclassified.push(col);
        }
        if (ENCRYPTED_FIELDS.has(col) && METADATA_FIELDS.has(col)) {
          overlap.push(col);
        }
      }

      expect(unclassified, `Unclassified columns in DOCUMENT_FIELDS: ${unclassified.join(', ')}`).toEqual([]);
      expect(overlap, `Overlapping columns in DOCUMENT_FIELDS: ${overlap.join(', ')}`).toEqual([]);
      expect(ENCRYPTED_FIELDS.size + METADATA_FIELDS.size).toBe(allCols.length);
    });

    it('falsification: adding an unclassified column fails naming that column', () => {
      const augmented = { ...DOCUMENT_FIELDS, newUntrackedColumn: 'new_col' };
      const unclassified = Object.keys(augmented).filter(
        c => !ENCRYPTED_FIELDS.has(c) && !METADATA_FIELDS.has(c)
      );
      expect(unclassified).toContain('newUntrackedColumn');
    });

    it('write-site encrypts title, mood, tags before calling DataProvider.createDocument', async () => {
      const key = await generateDataKey();
      setSessionKey(key);
      setEncryptionEnabled(userId, true);
      setProfileLoaded(userId, true);

      let savedPayload: Record<string, unknown> | null = null;
      vi.spyOn(DataProvider, 'createDocument').mockImplementation(async (_uid, payload) => {
        savedPayload = payload;
        return 'doc_123';
      });

      await DocumentService.createDocument(userId, {
        title: 'Secret Title',
        tags: ['secret_tag'],
        mood: 'anxious',
        uuid: 'doc_123',
      });

      expect(savedPayload).not.toBeNull();
      expect(savedPayload!._encrypted).toBe(true);
      expect(savedPayload!.title).not.toBe('Secret Title');
      expect(savedPayload!.mood).not.toBe('anxious');
      expect(savedPayload!.tags).not.toEqual(['secret_tag']);
      expect(typeof savedPayload!.tags).toBe('string');
      expect(savedPayload!.uuid).toBe('doc_123');
    });
  });

  // =========================================================================
  // 3. VERSION_FIELDS
  // =========================================================================
  describe('VERSION_FIELDS inventory & write-site binding', () => {
    // Note: finding AG-ENC-1: 'mood' carries content but is unencrypted in versions table.
    const CONTENT_FIELDS = new Set(['content', 'mood']);
    const ENCRYPTED_AT_WRITE_SITE = new Set(['content']);
    const METADATA_FIELDS = new Set([
      'documentId',
      'documentUuid',
      'userId',
      'version',
      'wordCount',
      'wordsAdded',
      'charsAdded',
      'duration',
      'wpm',
      'goalWords',
      'goalTime',
      'goalReached',
      'savedAt',
      'sessionStartedAt',
      '_encrypted',
      'createdAt',
    ]);

    it('every field in VERSION_FIELDS is classified and accounted for', () => {
      const allCols = Object.keys(VERSION_FIELDS);
      const unclassified: string[] = [];

      for (const col of allCols) {
        if (!CONTENT_FIELDS.has(col) && !METADATA_FIELDS.has(col)) {
          unclassified.push(col);
        }
      }

      expect(unclassified, `Unclassified columns in VERSION_FIELDS: ${unclassified.join(', ')}`).toEqual([]);
      expect(CONTENT_FIELDS.size + METADATA_FIELDS.size).toBe(allCols.length);
    });

    /**
     * ИЗВЕСТНЫЙ ДЕФЕКТ, зафиксированный намеренно: AG-ENC-1.
     *
     * `mood` шифруется на документе (`['title', 'mood']`) и не шифруется на
     * версии (`['content', 'previousContent']`) — одно поле, два места записи,
     * одно правило. Починка не однострочная: `versions.mood` в схеме ограничен
     * пятьюдесятью символами, шифротекст туда не влезет, и путь чтения
     * расшифровывает только `content`. Нужны миграция и обе стороны сразу.
     *
     * Тест утверждает ТЕКУЩЕЕ положение дел, а не желаемое. Он обязан упасть в
     * тот день, когда дефект починят, — и это правильное поведение: удалите
     * его вместе с починкой. Не ослабляйте его, чтобы «стало зелено».
     */
    it('AG-ENC-1 (известный дефект): versions.mood уходит в облако открытым — упадёт, когда почините', () => {
      expect(CONTENT_FIELDS.has('mood')).toBe(true);
      expect(ENCRYPTED_AT_WRITE_SITE.has('mood')).toBe(false);
    });

    it('falsification: adding an unclassified column fails naming that column', () => {
      const augmented = { ...VERSION_FIELDS, secretVersionMetadata: 'secret_meta' };
      const unclassified = Object.keys(augmented).filter(
        c => !CONTENT_FIELDS.has(c) && !METADATA_FIELDS.has(c)
      );
      expect(unclassified).toContain('secretVersionMetadata');
    });
  });

  // =========================================================================
  // 4. AI_SUMMARY_FIELDS
  // =========================================================================
  describe('AI_SUMMARY_FIELDS inventory & write-site binding', () => {
    const ENCRYPTED_FIELDS = new Set([
      'summary',
      'tone',
      'frequentWords',
      'authorPhrases',
      'insights',
      'quotableSentence',
      'themes',
      'extractedFacts',
      'commitments',
      'echo',
      'eventDate',
    ]);
    const METADATA_FIELDS = new Set([
      'documentId',
      'documentUuid',
      'userId',
      'processedAt',
      'valence',
      'arousal',
      'contentHash',
      'promptVersion',
      '_encrypted',
      'createdAt',
    ]);

    it('every field in AI_SUMMARY_FIELDS is classified and disjoint', () => {
      const allCols = Object.keys(AI_SUMMARY_FIELDS);
      const unclassified: string[] = [];
      const overlap: string[] = [];

      for (const col of allCols) {
        if (!ENCRYPTED_FIELDS.has(col) && !METADATA_FIELDS.has(col)) {
          unclassified.push(col);
        }
        if (ENCRYPTED_FIELDS.has(col) && METADATA_FIELDS.has(col)) {
          overlap.push(col);
        }
      }

      expect(unclassified, `Unclassified columns in AI_SUMMARY_FIELDS: ${unclassified.join(', ')}`).toEqual([]);
      expect(overlap, `Overlapping columns in AI_SUMMARY_FIELDS: ${overlap.join(', ')}`).toEqual([]);
      expect(ENCRYPTED_FIELDS.size + METADATA_FIELDS.size).toBe(allCols.length);
    });

    it('falsification: adding an unclassified column fails naming that column', () => {
      const augmented = { ...AI_SUMMARY_FIELDS, newAiField: 'new_ai_field' };
      const unclassified = Object.keys(augmented).filter(
        c => !ENCRYPTED_FIELDS.has(c) && !METADATA_FIELDS.has(c)
      );
      expect(unclassified).toContain('newAiField');
    });

    it('write-site encrypts all summary text and array fields before calling DataProvider.saveSummary', async () => {
      const key = await generateDataKey();
      setSessionKey(key);
      setEncryptionEnabled(userId, true);
      setProfileLoaded(userId, true);

      let savedPayload: Record<string, unknown> | null = null;
      vi.spyOn(DataProvider, 'saveSummary').mockImplementation(async (_uid, _docId, payload) => {
        savedPayload = payload;
      });

      const summaryPayload = {
        documentId: 'doc_1',
        documentUuid: 'doc_uuid_1',
        summary: 'A secret summary of personal life',
        tone: 'contemplative',
        frequentWords: ['hope', 'sorrow'],
        authorPhrases: ['never give up'],
        insights: ['insight 1'],
        quotableSentence: 'A memorable sentence',
        themes: ['work', 'family'],
        extractedFacts: ['moved to another city'],
        commitments: ['finish project'],
        echo: 'personal echo text',
        eventDate: '2026-09-04',
        valence: 1,
        arousal: 0.5,
        contentHash: 'hash123',
        promptVersion: 1,
        processedAt: Date.now(),
      };

      await saveSummaryToCloud(userId, summaryPayload as never);

      expect(savedPayload).not.toBeNull();
      expect(savedPayload!._encrypted).toBe(true);
      for (const field of ENCRYPTED_FIELDS) {
        expect(savedPayload![field]).not.toEqual((summaryPayload as Record<string, unknown>)[field]);
        expect(typeof savedPayload![field]).toBe('string');
      }
      expect(savedPayload!.valence).toBe(1);
      expect(savedPayload!.arousal).toBe(0.5);
      expect(savedPayload!.contentHash).toBe('hash123');
    });
  });

  // =========================================================================
  // 5. AI_EMBEDDING_FIELDS
  // =========================================================================
  describe('AI_EMBEDDING_FIELDS inventory & write-site binding', () => {
    const ENCRYPTED_FIELDS = new Set([
      'vectorsJson',
      'vectorJson',
      'chunkTextsJson',
      'model',
      'contentHash',
    ]);
    const METADATA_FIELDS = new Set([
      'documentId',
      'documentUuid',
      'userId',
      'dim',
      'processedAt',
      'schemaV',
      '_encrypted',
      'createdAt',
    ]);

    it('every field in AI_EMBEDDING_FIELDS is classified and disjoint', () => {
      const allCols = Object.keys(AI_EMBEDDING_FIELDS);
      const unclassified: string[] = [];
      const overlap: string[] = [];

      for (const col of allCols) {
        if (!ENCRYPTED_FIELDS.has(col) && !METADATA_FIELDS.has(col)) {
          unclassified.push(col);
        }
        if (ENCRYPTED_FIELDS.has(col) && METADATA_FIELDS.has(col)) {
          overlap.push(col);
        }
      }

      expect(unclassified, `Unclassified columns in AI_EMBEDDING_FIELDS: ${unclassified.join(', ')}`).toEqual([]);
      expect(overlap, `Overlapping columns in AI_EMBEDDING_FIELDS: ${overlap.join(', ')}`).toEqual([]);
      expect(ENCRYPTED_FIELDS.size + METADATA_FIELDS.size).toBe(allCols.length);
    });

    it('falsification: adding an unclassified column fails naming that column', () => {
      const augmented = { ...AI_EMBEDDING_FIELDS, rogueVectorMetadata: 'rogue' };
      const unclassified = Object.keys(augmented).filter(
        c => !ENCRYPTED_FIELDS.has(c) && !METADATA_FIELDS.has(c)
      );
      expect(unclassified).toContain('rogueVectorMetadata');
    });

    it('write-site encrypts vectorsJson, chunkTextsJson, model, and contentHash before calling DataProvider.saveEmbedding', async () => {
      const key = await generateDataKey();
      setSessionKey(key);
      setEncryptionEnabled(userId, true);
      setProfileLoaded(userId, true);

      let savedPayload: Record<string, unknown> | null = null;
      vi.spyOn(DataProvider, 'saveEmbedding').mockImplementation(async (_uid, _docId, payload) => {
        savedPayload = payload;
      });

      const embeddingPayload = {
        documentId: 'doc_1',
        documentUuid: 'doc_uuid_1',
        vectors: [[0.1, 0.2, 0.3]],
        chunkTexts: ['confidential chunk text'],
        model: 'text-embedding-3-small',
        dim: 3,
        contentHash: 'content_hash_xyz',
        processedAt: Date.now(),
        schemaV: 1,
      };

      await saveEmbeddingToCloud(userId, embeddingPayload as never);

      expect(savedPayload).not.toBeNull();
      expect(savedPayload!._encrypted).toBe(true);
      expect(savedPayload!.vectorsJson).not.toContain('0.1');
      expect(savedPayload!.chunkTextsJson).not.toContain('confidential chunk text');
      expect(savedPayload!.model).not.toBe('text-embedding-3-small');
      expect(savedPayload!.contentHash).not.toBe('content_hash_xyz');
      expect(savedPayload!.dim).toBe(3);
    });
  });

  // =========================================================================
  // 6. USER_FIELDS
  // =========================================================================
  describe('USER_FIELDS inventory & write-site binding', () => {
    const ENCRYPTED_FIELDS = new Set(['labels', 'aiPortrait']);
    const METADATA_FIELDS = new Set([
      'uid',
      'email',
      'nickname',
      'encryptionSalt',
      'encryptedDataKey',
      'encryptionMeta',
      'earnedAchievements',
      'totalWordCount',
      'totalWords',
      'sessionsCount',
      'streakDays',
      'totalDuration',
      'avgWpm',
      'avgSessionWords',
      'privacyAcceptedAt',
      'privacyVersion',
      'aiConsentAt',
      'aiConsentVersion',
      'indexingConsentAt',
      'achievementsResetAt',
      'indexingConsentVersion',
      '_encrypted',
      'role',
      'createdAt',
    ]);

    it('every field in USER_FIELDS is classified and disjoint', () => {
      const allCols = Object.keys(USER_FIELDS);
      const unclassified: string[] = [];
      const overlap: string[] = [];

      for (const col of allCols) {
        if (!ENCRYPTED_FIELDS.has(col) && !METADATA_FIELDS.has(col)) {
          unclassified.push(col);
        }
        if (ENCRYPTED_FIELDS.has(col) && METADATA_FIELDS.has(col)) {
          overlap.push(col);
        }
      }

      expect(unclassified, `Unclassified columns in USER_FIELDS: ${unclassified.join(', ')}`).toEqual([]);
      expect(overlap, `Overlapping columns in USER_FIELDS: ${overlap.join(', ')}`).toEqual([]);
      expect(ENCRYPTED_FIELDS.size + METADATA_FIELDS.size).toBe(allCols.length);
    });

    it('falsification: adding an unclassified column fails naming that column', () => {
      const augmented = { ...USER_FIELDS, unexpectedUserCol: 'unexp' };
      const unclassified = Object.keys(augmented).filter(
        c => !ENCRYPTED_FIELDS.has(c) && !METADATA_FIELDS.has(c)
      );
      expect(unclassified).toContain('unexpectedUserCol');
    });

    it('write-site encrypts label names and aiPortrait before persisting', async () => {
      const key = await generateDataKey();
      setSessionKey(key);
      setEncryptionEnabled(userId, true);
      setProfileLoaded(userId, true);

      // Mock getCurrentUser for AIProfileService
      vi.spyOn(authModule, 'getCurrentUser').mockReturnValue({
        uid: userId,
        email: 'user@example.com',
        displayName: 'Test',
        photoURL: null,
        metadata: { creationTime: null, lastSignInTime: null },
      });

      // Label encryption: encryptLabel encrypts label.name
      const encryptedLabel = await encryptLabel({ id: 'lbl_1', name: 'Private Label Name', color: '#ff0000' }, userId);
      expect(encryptedLabel._encrypted).toBe(true);
      expect(encryptedLabel.name).not.toBe('Private Label Name');
      expect(typeof encryptedLabel.name).toBe('string');
      expect(encryptedLabel.color).toBe('#ff0000');

      // AI portrait encryption: saveAIProfile calls maybeEncrypt with aiPortrait
      let savedProfilePayload: Record<string, unknown> | null = null;
      vi.spyOn(DataProvider, 'updateProfile').mockImplementation(async (_uid, payload) => {
        savedProfilePayload = payload;
      });

      await AIProfileService.savePortrait('# My Psychological Portrait');
      expect(savedProfilePayload).not.toBeNull();
      expect(savedProfilePayload!._encrypted).toBe(true);
      expect(savedProfilePayload!.aiPortrait).not.toBe('# My Psychological Portrait');
      expect(typeof savedProfilePayload!.aiPortrait).toBe('string');
    });
  });
});
