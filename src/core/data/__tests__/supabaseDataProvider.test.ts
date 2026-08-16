import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupabaseDataProvider } from '../supabaseDataProvider';
import * as supabaseClientModule from '../../supabase/client';

interface MockQueryBuilder {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  gt: ReturnType<typeof vi.fn>;
  contains: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  then: ReturnType<typeof vi.fn>;
}

describe('SupabaseDataProvider', () => {
  let mockFrom: ReturnType<typeof vi.fn>;
  let mockChannel: ReturnType<typeof vi.fn>;
  let mockQueryBuilder: MockQueryBuilder;

  beforeEach(() => {
    mockQueryBuilder = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: null, error: null }),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      contains: vi.fn().mockResolvedValue({ data: [], error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      then: vi.fn().mockImplementation((resolve) => Promise.resolve({ data: null, error: null }).then(resolve)),
    };

    mockFrom = vi.fn().mockReturnValue(mockQueryBuilder);
    mockChannel = vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    });

    vi.spyOn(supabaseClientModule, 'getSupabase').mockReturnValue({
      from: mockFrom,
      channel: mockChannel,
      removeChannel: vi.fn().mockResolvedValue('ok'),
    } as unknown as ReturnType<typeof supabaseClientModule.getSupabase>);
  });

  describe('documents', () => {
    it('createDocument transforms camelCase to snake_case and removes id', async () => {
      const docId = await SupabaseDataProvider.createDocument('user-1', {
        id: 'doc-1',
        title: 'Test Note',
        totalWords: 150,
        currentVersion: 1,
        firstSessionAt: new Date('2026-08-15T12:00:00.000Z'),
        labelId: 'lbl-1',
        mood: 'happy',
        unknownProperty: 'should-be-dropped',
      });

      expect(docId).toBe('doc-1');
      expect(mockFrom).toHaveBeenCalledWith('documents');
      expect(mockQueryBuilder.insert).toHaveBeenCalledWith({
        uuid: 'doc-1',
        user_id: 'user-1',
        title: 'Test Note',
        total_words: 150,
        current_version: 1,
        first_session_at: '2026-08-15T12:00:00.000Z',
        label_id: 'lbl-1',
        mood: 'happy',
      });
      // Ensure unknownProperty and auto-generated id are not present
      const insertedPayload = mockQueryBuilder.insert.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(insertedPayload).not.toHaveProperty('unknownProperty');
      expect(insertedPayload).not.toHaveProperty('id');
    });

    it('getDocument transforms snake_case to camelCase and converts dates to ms', async () => {
      mockQueryBuilder.maybeSingle.mockResolvedValueOnce({
        data: {
          id: 42,
          uuid: 'doc-1',
          user_id: 'user-1',
          title: 'Test Note',
          total_words: 150,
          current_version: 2,
          first_session_at: '2026-08-15T12:00:00.000Z',
          last_session_at: null,
          label_id: null,
        },
        error: null,
      });

      const doc = await SupabaseDataProvider.getDocument('user-1', 'doc-1');
      expect(doc).toEqual({
        id: 'doc-1',
        uuid: 'doc-1',
        userId: 'user-1',
        title: 'Test Note',
        totalWords: 150,
        currentVersion: 2,
        firstSessionAt: Date.parse('2026-08-15T12:00:00.000Z'),
        lastSessionAt: null,
      });
      // Null non-date fields like label_id should be omitted for Zod schema defaults
      expect(doc).not.toHaveProperty('labelId');
    });

    it('updateDocumentSessionStats with provided sessionsCount transforms stats', async () => {
      await SupabaseDataProvider.updateDocumentSessionStats('user-1', 'doc-1', {
        totalWords: 300,
        totalDuration: 600,
        currentVersion: 3,
        sessionsCount: 5,
        mood: 'calm',
        lastSessionAt: new Date('2026-08-15T13:00:00.000Z'),
      });

      expect(mockFrom).toHaveBeenCalledWith('documents');
      expect(mockQueryBuilder.update).toHaveBeenCalledWith({
        total_words: 300,
        total_duration: 600,
        current_version: 3,
        sessions_count: 5,
        mood: 'calm',
        last_session_at: '2026-08-15T13:00:00.000Z',
      });
      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('user_id', 'user-1');
      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('uuid', 'doc-1');
    });

    it('updateDocumentSessionStats increments sessionsCount when not provided', async () => {
      mockQueryBuilder.maybeSingle.mockResolvedValueOnce({
        data: { sessions_count: 7 },
        error: null,
      });

      await SupabaseDataProvider.updateDocumentSessionStats('user-1', 'doc-1', {
        totalWords: 400,
        totalDuration: 800,
        currentVersion: 4,
      });

      expect(mockQueryBuilder.select).toHaveBeenCalledWith('sessions_count');
      expect(mockQueryBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          total_words: 400,
          total_duration: 800,
          current_version: 4,
          sessions_count: 8,
        })
      );
    });

    it('clearLabelFromAllDocs uses label_id in both update and eq filter', async () => {
      await SupabaseDataProvider.clearLabelFromAllDocs('user-1', 'label-xyz');

      expect(mockFrom).toHaveBeenCalledWith('documents');
      expect(mockQueryBuilder.update).toHaveBeenCalledWith({ label_id: null });
      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('user_id', 'user-1');
      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('label_id', 'label-xyz');
    });
  });

  describe('versions', () => {
    it('addVersion maps documentId to document_uuid and converts fields to snake_case', async () => {
      await SupabaseDataProvider.addVersion('user-1', 'doc-1', '1', {
        version: 1,
        content: 'Hello world',
        wordCount: 2,
        wordsAdded: 2,
        charsAdded: 11,
        duration: 30,
        wpm: 60,
        goalWords: 500,
        savedAt: new Date('2026-08-15T12:00:00.000Z'),
        sessionStartedAt: 1786752000000,
        _encrypted: false,
      });

      expect(mockFrom).toHaveBeenCalledWith('versions');
      expect(mockQueryBuilder.upsert).toHaveBeenCalledWith({
        document_uuid: 'doc-1',
        user_id: 'user-1',
        version: 1,
        content: 'Hello world',
        word_count: 2,
        words_added: 2,
        chars_added: 11,
        duration: 30,
        wpm: 60,
        goal_words: 500,
        saved_at: '2026-08-15T12:00:00.000Z',
        session_started_at: new Date(1786752000000).toISOString(),
        _encrypted: false,
      });
    });

    it('getVersions reads snake_case rows into camelCase version objects', async () => {
      mockQueryBuilder.eq.mockReturnValueOnce(mockQueryBuilder);
      mockQueryBuilder.eq.mockResolvedValueOnce({
        data: [
          {
            id: 10,
            document_uuid: 'doc-1',
            user_id: 'user-1',
            version: 1,
            content: 'Hello',
            word_count: 1,
            words_added: 1,
            chars_added: 5,
            duration: 10,
            wpm: 60,
            saved_at: '2026-08-15T12:00:00.000Z',
          },
        ],
        error: null,
      });

      const versions = await SupabaseDataProvider.getVersions('user-1', 'doc-1');
      expect(versions).toHaveLength(1);
      expect(versions[0]).toEqual({
        id: '10',
        documentId: 'doc-1',
        userId: 'user-1',
        version: 1,
        content: 'Hello',
        wordCount: 1,
        wordsAdded: 1,
        charsAdded: 5,
        duration: 10,
        wpm: 60,
        savedAt: Date.parse('2026-08-15T12:00:00.000Z'),
      });
    });
  });

  describe('drafts', () => {
    it('saveDraft converts camelCase to snake_case and sets updated_at', async () => {
      await SupabaseDataProvider.saveDraft('user-1', {
        title: 'Draft Title',
        content: 'Draft content',
        wordCount: 20,
        initialWordCount: 5,
        activeSessionId: 'sess-1',
        pinnedThoughts: ['thought 1'],
        _encrypted: false,
      });

      expect(mockFrom).toHaveBeenCalledWith('drafts');
      expect(mockQueryBuilder.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-1',
          title: 'Draft Title',
          content: 'Draft content',
          word_count: 20,
          initial_word_count: 5,
          active_session_id: 'sess-1',
          pinned_thoughts: ['thought 1'],
          _encrypted: false,
          updated_at: expect.any(String),
        })
      );
    });

    it('getDraft reads draft and maps snake_case to camelCase', async () => {
      mockQueryBuilder.maybeSingle.mockResolvedValueOnce({
        data: {
          user_id: 'user-1',
          title: 'Draft Title',
          content: 'Draft content',
          word_count: 20,
          initial_word_count: 5,
          active_session_id: 'sess-1',
          pinned_thoughts: ['thought 1'],
          updated_at: '2026-08-15T12:00:00.000Z',
        },
        error: null,
      });

      const draft = await SupabaseDataProvider.getDraft('user-1');
      expect(draft).toEqual({
        id: 'user-1',
        userId: 'user-1',
        title: 'Draft Title',
        content: 'Draft content',
        wordCount: 20,
        initialWordCount: 5,
        activeSessionId: 'sess-1',
        pinnedThoughts: ['thought 1'],
        updatedAt: Date.parse('2026-08-15T12:00:00.000Z'),
      });
    });
  });

  describe('ai_summaries and ai_embeddings', () => {
    it('saveSummary maps camelCase to snake_case', async () => {
      await SupabaseDataProvider.saveSummary('user-1', 'doc-1', {
        summary: 'Summary text',
        tone: 'reflective',
        frequentWords: ['life', 'writing'],
        authorPhrases: ['phrase one'],
        quotableSentence: 'A quote',
        extractedFacts: ['Fact 1'],
        contentHash: 'hash123',
        promptVersion: 2,
      });

      expect(mockFrom).toHaveBeenCalledWith('ai_summaries');
      expect(mockQueryBuilder.upsert).toHaveBeenCalledWith({
        user_id: 'user-1',
        document_id: 'doc-1',
        summary: 'Summary text',
        tone: 'reflective',
        frequent_words: ['life', 'writing'],
        author_phrases: ['phrase one'],
        quotable_sentence: 'A quote',
        extracted_facts: ['Fact 1'],
        content_hash: 'hash123',
        prompt_version: 2,
      });
    });

    it('saveEmbedding maps vectorsJson and chunkTextsJson to snake_case', async () => {
      await SupabaseDataProvider.saveEmbedding('user-1', 'doc-1', {
        vectorsJson: '[[0.1, 0.2]]',
        chunkTextsJson: '["chunk 1"]',
        model: 'gemini-embedding-001',
        dim: 768,
        schemaV: 3,
        processedAt: 123456789,
      });

      expect(mockFrom).toHaveBeenCalledWith('ai_embeddings');
      expect(mockQueryBuilder.upsert).toHaveBeenCalledWith({
        user_id: 'user-1',
        document_id: 'doc-1',
        vectors_json: '[[0.1, 0.2]]',
        chunk_texts_json: '["chunk 1"]',
        model: 'gemini-embedding-001',
        dim: 768,
        schema_v: 3,
        processed_at: 123456789,
      });
    });
  });

  describe('users and encryptionMeta', () => {
    it('getProfile correctly returns encryptionMeta from snake_case encryption_meta', async () => {
      const meta = { salt: 's123', version: 1, wrappedDataKey: 'wdk123', verification: 'v123' };
      mockQueryBuilder.maybeSingle.mockResolvedValueOnce({
        data: {
          uid: 'user-1',
          email: 'user@test.com',
          nickname: 'Tester',
          encryption_meta: meta,
          total_word_count: 500,
          earned_achievements: ['ach-1'],
        },
        error: null,
      });

      const profile = await SupabaseDataProvider.getProfile('user-1');
      expect(profile).toEqual({
        id: 'user-1',
        uid: 'user-1',
        email: 'user@test.com',
        nickname: 'Tester',
        encryptionMeta: meta,
        totalWordCount: 500,
        earnedAchievements: ['ach-1'],
      });
    });

    it('saveEncryptionMeta updates encryption_meta and zeroes out legacy fields', async () => {
      const meta = { salt: 's123', version: 1, wrappedDataKey: 'wdk123', verification: 'v123' };
      await SupabaseDataProvider.saveEncryptionMeta('user-1', {
        encryptionMeta: meta,
        encryptionSalt: 'old-salt',
        encryptedDataKey: 'old-key',
      });

      expect(mockFrom).toHaveBeenCalledWith('users');
      expect(mockQueryBuilder.update).toHaveBeenCalledWith({
        encryption_meta: meta,
        encryption_salt: null,
        encrypted_data_key: null,
      });
      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('uid', 'user-1');
    });

    it('subscribeToProfile parses realtime payload with fromDb', () => {
      let callback: ((payload: { new: Record<string, unknown> }) => void) | undefined;
      mockChannel.mockReturnValueOnce({
        on: vi.fn().mockImplementation((_event, _opts, cb) => {
          callback = cb;
          return { subscribe: vi.fn() };
        }),
      });

      const onUpdate = vi.fn();
      SupabaseDataProvider.subscribeToProfile('user-1', onUpdate);

      expect(callback).toBeDefined();
      callback!({
        new: {
          uid: 'user-1',
          nickname: 'New Nickname',
          encryption_meta: { salt: 's', version: 1, wrappedDataKey: 'w', verification: 'v' },
          total_word_count: 100,
        },
      });

      expect(onUpdate).toHaveBeenCalledWith({
        id: 'user-1',
        uid: 'user-1',
        nickname: 'New Nickname',
        encryptionMeta: { salt: 's', version: 1, wrappedDataKey: 'w', verification: 'v' },
        totalWordCount: 100,
      });
    });
  });
});
