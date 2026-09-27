import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupabaseDataProvider, likePrefix } from '../supabaseDataProvider';
import * as supabaseClientModule from '../../supabase/client';

interface MockQueryBuilder {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  like: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  gt: ReturnType<typeof vi.fn>;
  contains: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
  then: ReturnType<typeof vi.fn>;
  // 2.17: счётчик сессий переехал на RPC вместо чтения-изменения-записи.
  rpc: ReturnType<typeof vi.fn>;
}

describe('SupabaseDataProvider', () => {
  let mockFrom: ReturnType<typeof vi.fn>;
  let mockChannel: ReturnType<typeof vi.fn>;
  let mockQueryBuilder: MockQueryBuilder;

  beforeEach(() => {
    mockQueryBuilder = {
      select: vi.fn().mockReturnThis(),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      like: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: null, error: null }),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      contains: vi.fn().mockResolvedValue({ data: [], error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      range: vi.fn().mockImplementation(() => Promise.resolve({ data: [], error: null })),
      then: vi.fn().mockImplementation((resolve: (val: unknown) => unknown) => resolve({ data: null, error: null })),
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
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
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

    it('updateDocumentSessionStats increments sessionsCount atomically via rpc when not provided', async () => {
      await SupabaseDataProvider.updateDocumentSessionStats('user-1', 'doc-1', {
        totalWords: 400,
        totalDuration: 800,
        currentVersion: 4,
      });

      // #48: инкремент атомарен в БД (rpc), read-modify-write больше нет.
      expect(supabaseClientModule.getSupabase().rpc).toHaveBeenCalledWith('increment_document_sessions', {
        p_uuid: 'doc-1',
        p_delta: 1,
      });
      // Метаданные пишутся без sessions_count — его только что посчитал rpc.
      expect(mockQueryBuilder.update).toHaveBeenCalledWith(
        expect.not.objectContaining({ sessions_count: expect.anything() })
      );
      expect(mockQueryBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          total_words: 400,
          total_duration: 800,
          current_version: 4,
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
      mockQueryBuilder.range.mockResolvedValueOnce({
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

    // session_start_time — epoch-ms, а не дата: карта полей не должна уводить её
    // в ISO-строку, иначе bigint-колонка получит текст. Колонка была `real` и
    // округляла метку на секунды, см. миграцию 0010.
    it('saveDraft keeps sessionStartTime an exact epoch-ms number', async () => {
      await SupabaseDataProvider.saveDraft('user-1', {
        content: 'Draft content',
        sessionStartTime: 1786752000000,
        accumulatedDuration: 42,
      });

      const payload = mockQueryBuilder.upsert.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload.session_start_time).toBe(1786752000000);
      expect(payload.accumulated_duration).toBe(42);
    });

    it('getDraft returns sessionStartTime unchanged', async () => {
      mockQueryBuilder.maybeSingle.mockResolvedValueOnce({
        data: { user_id: 'user-1', content: 'c', session_start_time: 1786752000000 },
        error: null,
      });

      const draft = await SupabaseDataProvider.getDraft('user-1');
      expect(draft?.sessionStartTime).toBe(1786752000000);
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

    it('subscribeToProfile opens no realtime channel (N-11: the publication is empty)', () => {
      SupabaseDataProvider.subscribeToProfile('user-1', vi.fn());
      expect(mockChannel).not.toHaveBeenCalled();
    });
  });

  describe('executeMigrationBatch', () => {
    // Вызывающий (encryptMigration) после возврата помечает батч мигрированным
    // и стирает чекпоинт. Молчаливый отказ записи = незашифрованная заметка
    // остаётся в облаке, а миграция отчитывается «готово».
    it.each([
      ['version', { type: 'version' as const, userId: 'u1', documentId: 'd1', versionId: 'v1', data: {} }],
      ['draft', { type: 'draft' as const, userId: 'u1', draftId: 'dr1', data: {} }],
    ])('пробрасывает ошибку upsert для %s', async (_name, op) => {
      mockQueryBuilder.upsert.mockResolvedValue({ data: null, error: { message: 'RLS denied' } });
      await expect(SupabaseDataProvider.executeMigrationBatch([op])).rejects.toMatchObject({ message: 'RLS denied' });
    });

    it('пробрасывает ошибку update для document', async () => {
      mockQueryBuilder.eq.mockReturnValueOnce(mockQueryBuilder);
      mockQueryBuilder.eq.mockResolvedValueOnce({ data: null, error: { message: 'RLS denied' } });
      await expect(SupabaseDataProvider.executeMigrationBatch([
        { type: 'document', userId: 'u1', documentId: 'd1', data: {} },
      ])).rejects.toMatchObject({ message: 'RLS denied' });
    });

    it('успешный батч не бросает', async () => {
      await expect(SupabaseDataProvider.executeMigrationBatch([
        { type: 'draft', userId: 'u1', draftId: 'dr1', data: {} },
      ])).resolves.toBeUndefined();
    });
  });

  describe('AG-DX-A: LIKE escaping in local_store_records deletion', () => {
    it('escapes backslash, percent and underscore in likePrefix', () => {
      expect(likePrefix('simple')).toBe('simple#%');
      expect(likePrefix('a%b')).toBe('a\\%b#%');
      expect(likePrefix('a_b')).toBe('a\\_b#%');
      expect(likePrefix('a\\b')).toBe('a\\\\b#%');
      expect(likePrefix('a%b_c\\d')).toBe('a\\%b\\_c\\\\d#%');
    });

    it('deleteLocalStoreRecord uses likePrefix for paged cleanup', async () => {
      mockQueryBuilder.eq.mockReturnValue(mockQueryBuilder);
      mockQueryBuilder.like.mockReturnValue(mockQueryBuilder);

      await SupabaseDataProvider.deleteLocalStoreRecord('user-1', 'testStore', 'a%b');

      expect(mockQueryBuilder.like).toHaveBeenCalledWith('key', 'a\\%b#%');
    });

    it('deleteLocalStorePagedRecords uses likePrefix for paged cleanup', async () => {
      mockQueryBuilder.eq.mockReturnValue(mockQueryBuilder);
      mockQueryBuilder.like.mockReturnValue(mockQueryBuilder);

      await SupabaseDataProvider.deleteLocalStorePagedRecords?.('user-1', 'testStore', 'a_b');

      expect(mockQueryBuilder.like).toHaveBeenCalledWith('key', 'a\\_b#%');
    });

    it('deleteLocalStorePagedRecords with keepPages removes only the stale tail (pages ≥ keepPages)', async () => {
      mockQueryBuilder.then.mockImplementationOnce((resolve: (val: unknown) => unknown) =>
        resolve({ data: [{ key: 'k#0' }, { key: 'k#1' }, { key: 'k#2' }, { key: 'k#10' }], error: null }));

      await SupabaseDataProvider.deleteLocalStorePagedRecords?.('user-1', 'aiDialogues', 'k', 2);

      expect(mockQueryBuilder.in).toHaveBeenCalledWith('key', ['k#2', 'k#10']);
    });
  });

  describe('deleteDocument — надгробие', () => {
    // Смысл надгробия в том, что содержимое стёрто, а не спрятано. Если
    // удаление версий провалилось молча, текст заметки остаётся в облаке при
    // документе, помеченном удалённым, — а RLS запрещает менять надгробие,
    // то есть починить это потом уже нельзя.
    it('пробрасывает ошибку удаления версий и не ставит надгробие', async () => {
      mockQueryBuilder.eq.mockReturnValue(mockQueryBuilder);
      mockQueryBuilder.then.mockImplementationOnce((resolve: (v: unknown) => unknown) => {
        void Promise.resolve({ data: null, error: { message: 'versions delete failed' } }).then(resolve);
      });
      await expect(SupabaseDataProvider.deleteDocument('u1', 'doc-1'))
        .rejects.toMatchObject({ message: 'versions delete failed' });
      expect(mockQueryBuilder.update).not.toHaveBeenCalled();
    });
  });

  describe('S-16: Clear AI Data server-side deletions', () => {
    it('deleteAllEmbeddings deletes all rows for userId', async () => {
      mockQueryBuilder.eq.mockReturnValue(mockQueryBuilder);
      mockQueryBuilder.delete.mockReturnValue(mockQueryBuilder);
      mockQueryBuilder.then.mockImplementationOnce((resolve: (v: unknown) => unknown) => {
        void Promise.resolve({ data: null, error: null }).then(resolve);
      });

      await SupabaseDataProvider.deleteAllEmbeddings('u1');

      expect(mockFrom).toHaveBeenCalledWith('ai_embeddings');
      expect(mockQueryBuilder.delete).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.delete).toHaveBeenCalledWith();
      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('user_id', 'u1');
    });

    it('deleteAllSummaries deletes all rows for userId', async () => {
      mockQueryBuilder.eq.mockReturnValue(mockQueryBuilder);
      mockQueryBuilder.delete.mockReturnValue(mockQueryBuilder);
      mockQueryBuilder.then.mockImplementationOnce((resolve: (v: unknown) => unknown) => {
        void Promise.resolve({ data: null, error: null }).then(resolve);
      });

      await SupabaseDataProvider.deleteAllSummaries('u1');

      expect(mockFrom).toHaveBeenCalledWith('ai_summaries');
      expect(mockQueryBuilder.delete).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.delete).toHaveBeenCalledWith();
      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('user_id', 'u1');
    });

    it('deleteLocalStoreRecordsByStores deletes specified stores for userId', async () => {
      mockQueryBuilder.eq.mockReturnValue(mockQueryBuilder);
      mockQueryBuilder.delete.mockReturnValue(mockQueryBuilder);
      mockQueryBuilder.in.mockReturnValue(mockQueryBuilder);
      mockQueryBuilder.then.mockImplementationOnce((resolve: (v: unknown) => unknown) => {
        void Promise.resolve({ data: null, error: null }).then(resolve);
      });

      await SupabaseDataProvider.deleteLocalStoreRecordsByStores('u1', ['aiPortrait', 'aiDialogues']);

      expect(mockFrom).toHaveBeenCalledWith('local_store_records');
      expect(mockQueryBuilder.delete).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.delete).toHaveBeenCalledWith();
      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('user_id', 'u1');
      expect(mockQueryBuilder.in).toHaveBeenCalledWith('store', ['aiPortrait', 'aiDialogues']);
    });
  });
});
