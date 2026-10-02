import { describe, it, expect, vi, beforeEach } from 'vitest';

const localStore: {
  aiSummaries: Map<string, unknown>;
  aiEmbeddings: Map<string, unknown>;
  aiTimeline: Map<string, unknown>;
  documents: Map<string, unknown>;
  aiPortrait: Map<string, unknown>;
  aiDialogues: Map<string, unknown>;
  aiProfileFacets: Map<string, unknown>;
  lifeStory: Map<string, unknown>;
} = {
  aiSummaries: new Map(),
  aiEmbeddings: new Map(),
  aiTimeline: new Map(),
  documents: new Map(),
  aiPortrait: new Map(),
  aiDialogues: new Map(),
  aiProfileFacets: new Map(),
  lifeStory: new Map(),
};
type StoreName = keyof typeof localStore;

vi.mock('../../../../core/storage/localDb', () => ({
  getLocalDb: vi.fn(async () => ({
    objectStoreNames: {
      contains: (s: string) => s in localStore,
    },
    getAllKeys: async (store: StoreName) => [...(localStore[store]?.keys() ?? [])],
    getAll: async (store: StoreName) => [...(localStore[store]?.values() ?? [])],
    get: async (store: StoreName, key: string) => localStore[store]?.get(key),
    put: async (store: StoreName, value: { documentId?: string; id?: string; eventDate?: string }) => {
      const key = (value.documentId ?? value.id ?? value.eventDate)!;
      if (localStore[store] === undefined) localStore[store] = new Map();
      localStore[store].set(key, value);
    },
    delete: async (store: StoreName, key: string) => {
      localStore[store]?.delete(key);
    },
  })),
}));

const latestContent = new Map<string, string>();
vi.mock('../../../../core/services/LocalVersionService', () => ({
  LocalVersionService: {
    getLatestContent: async (id: string) => latestContent.get(id) ?? '',
  },
}));

vi.mock('../../utils/embeddingIndexer', () => ({
  sha256Hex: async (text: string) => `hash-of:${text}`,
}));

vi.mock('../AIThemeLedgerService', () => ({ enqueuePendingThemeTouch: vi.fn() }));

const summaryDocs: Array<{ id: string; data: () => unknown }> = [];
const embeddingDocs: Array<{ id: string; data: () => unknown }> = [];
const localStoreRecordsDocs: Array<{ store: string; key: string; payload: Record<string, unknown>; checksum?: string }> = [];
const providerCalls: Array<[string, unknown[]]> = [];

vi.mock('../../../../core/data', () => ({
  DataProvider: {
    getUserSummaries: async (...a: unknown[]) => { providerCalls.push(['summaries', a]); return summaryDocs.map(d => ({ id: d.id, ...(d.data() as any) })); },
    getUserEmbeddingsPaginated: async (_uid: string, limit: number, cursor?: string) => {
      providerCalls.push(['embeddings', [_uid]]);
      const all = embeddingDocs;
      const start = cursor ? all.findIndex(d => d.id === cursor) + 1 : 0;
      const slice = all.slice(start, start + limit);
      return {
        items: slice.map(d => ({ id: d.id, ...(d.data() as any) })),
        nextCursorId: slice.length === limit ? slice[slice.length - 1]?.id ?? null : null,
        readCount: slice.length,
      };
    },
    getLocalStoreRecords: async (...a: unknown[]) => { providerCalls.push(['localStore', a]); return localStoreRecordsDocs; },
  },
}));

const getSessionKey = vi.fn(() => ({} as CryptoKey));
vi.mock('../../../../core/crypto/encrypt', () => ({ getSessionKey: () => getSessionKey() }));

const getEncryptionEnabled = vi.fn((_uid: string) => true);
const maybeDecrypt = vi.fn(async (doc: Record<string, unknown>, _strFields?: string[], _arrFields?: string[]) => doc);
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: (uid: string) => getEncryptionEnabled(uid),
  maybeDecrypt: (doc: Record<string, unknown>, strFields?: string[], arrFields?: string[]) => maybeDecrypt(doc, strFields, arrFields),
}));

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/errors/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u_reattach' }) }));

const decodeCloudSummary = vi.fn(async (d: Record<string, unknown>, id: string) => ({ documentId: id, tone: d.tone }));
vi.mock('../AISummaryService', () => ({
  decodeCloudSummary: (d: Record<string, unknown>, id: string) => decodeCloudSummary(d, id),
}));

const decodeCloudEmbedding = vi.fn(async (_d: Record<string, unknown>, id: string) => ({ documentId: id, vectors: [[1]] }));
vi.mock('../AIEmbeddingService', () => ({
  decodeCloudEmbedding: (d: Record<string, unknown>, id: string) => decodeCloudEmbedding(d, id),
}));

import { restoreAIDataFromCloud, reattachOrphanedAnalysis, requestEmbeddingRestore } from '../AIRestoreService';
import { reportError } from '../../../../shared/errors/reportError';
import { logger } from '../../../../shared/errors/logger';
import { MAX_RESTORE_RECORD_BYTES } from '../../../../core/services/LocalStoreSyncService';

describe('restoreAIDataFromCloud', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStore.aiSummaries = new Map();
    localStore.aiEmbeddings = new Map();
    localStore.aiTimeline = new Map();
    localStore.documents = new Map();
    localStore.aiPortrait = new Map();
    localStore.aiDialogues = new Map();
    localStore.aiProfileFacets = new Map();
    localStore.lifeStory = new Map();
    latestContent.clear();
    summaryDocs.length = 0;
    embeddingDocs.length = 0;
    localStoreRecordsDocs.length = 0;
    getSessionKey.mockReturnValue({} as CryptoKey);
    getEncryptionEnabled.mockReturnValue(true);
    // Pulling embeddings is opt-in: the collection costs more read units than a
    // whole free day. These cases exercise the restore itself, so they opt in.
    requestEmbeddingRestore('user_1');
    requestEmbeddingRestore('user-a');
  });

  // Разбор с компьютера доезжал до ноутбука только на следующий день: полный
  // забор шёл раз в сутки. Инкрементальный — каждый фоновый проход.
  it('incremental pull asks the cloud only for changes since the cursor and skips vectors', async () => {
    providerCalls.length = 0;
    requestEmbeddingRestore('user_1');
    await restoreAIDataFromCloud('user_1', { sinceMs: 1_790_000_000_000 });
    expect(providerCalls).toContainEqual(['summaries', ['user_1', 1_790_000_000_000]]);
    expect(providerCalls).toContainEqual(['localStore', ['user_1', undefined, 1_790_000_000_000]]);
    expect(providerCalls.some(([k]) => k === 'embeddings')).toBe(false);
  });

  // Повторный разбор заметки на компьютере не доезжал до ноутбука: любой
  // локальный разбор блокировал облачный навсегда, без сравнения времени.
  it('replaces an older local analysis with a newer cloud one, and keeps a newer local one', async () => {
    localStore.documents.set('local_n', { id: 'local_n', uuid: 'uuid-n', lastSessionAt: 1000 });
    localStore.aiSummaries.set('local_n', { documentId: 'local_n', documentUuid: 'uuid-n', tone: 'old', processedAt: 100 });
    decodeCloudSummary.mockImplementation(async (d: Record<string, unknown>, id: string) => ({
      documentId: id, documentUuid: 'uuid-n', tone: d.tone, processedAt: d.processedAt,
    }));
    summaryDocs.push({ id: 'uuid-n', data: () => ({ tone: 'new', processedAt: 200 }) });

    await restoreAIDataFromCloud('user_1', { sinceMs: 0 });
    expect(localStore.aiSummaries.get('local_n')).toMatchObject({ tone: 'new', processedAt: 200 });
    expect(localStore.aiSummaries.has('uuid-n')).toBe(false);

    summaryDocs.length = 0;
    summaryDocs.push({ id: 'uuid-n', data: () => ({ tone: 'stale', processedAt: 150 }) });
    await restoreAIDataFromCloud('user_1', { sinceMs: 0 });
    expect(localStore.aiSummaries.get('local_n')).toMatchObject({ tone: 'new' });
  });

  it('restores local_store_records (aiPortrait, aiDialogues, lifeStory) when missing locally', async () => {
    localStoreRecordsDocs.push({
      store: 'aiPortrait',
      key: 'singleton',
      payload: { data: JSON.stringify({ id: 'singleton', portrait: 'Cloud Portrait', updatedAt: 2000 }) },
    });
    localStoreRecordsDocs.push({
      store: 'lifeStory',
      key: '2026-08-19',
      payload: { data: JSON.stringify({ eventDate: '2026-08-19', text: 'Story entry', generatedAt: 2000 }) },
    });

    const res = await restoreAIDataFromCloud('user_1');

    expect(res.localStoreRecords).toBe(2);
    expect(localStore.aiPortrait.get('singleton')).toMatchObject({ portrait: 'Cloud Portrait' });
    expect(localStore.lifeStory.get('2026-08-19')).toMatchObject({ text: 'Story entry' });
  });

  it('preserves local record when local timestamp is newer or equal to cloud', async () => {
    localStore.aiPortrait.set('singleton', { id: 'singleton', portrait: 'Local Newer', updatedAt: 5000 });
    localStoreRecordsDocs.push({
      store: 'aiPortrait',
      key: 'singleton',
      payload: { data: JSON.stringify({ id: 'singleton', portrait: 'Cloud Older', updatedAt: 3000 }) },
    });

    const res = await restoreAIDataFromCloud('user_1');

    expect(res.localStoreRecords).toBe(0);
    expect(localStore.aiPortrait.get('singleton')).toMatchObject({ portrait: 'Local Newer' });
  });

  it('strictly preserves local record when either local or cloud lacks a timestamp', async () => {
    // Local has no timestamp field!
    localStore.aiPortrait.set('singleton', { id: 'singleton', portrait: 'Local Untimestamped' });
    localStoreRecordsDocs.push({
      store: 'aiPortrait',
      key: 'singleton',
      payload: { data: JSON.stringify({ id: 'singleton', portrait: 'Cloud Timestamped', updatedAt: 5000 }) },
    });

    const res = await restoreAIDataFromCloud('user_1');

    expect(res.localStoreRecords).toBe(0);
    // Local wins unconditionally!
    expect(localStore.aiPortrait.get('singleton')).toMatchObject({ portrait: 'Local Untimestamped' });
  });

  it('overwrites local record only when both timestamps exist and cloud is newer', async () => {
    localStore.aiPortrait.set('singleton', { id: 'singleton', portrait: 'Local Older', updatedAt: 1000 });
    localStoreRecordsDocs.push({
      store: 'aiPortrait',
      key: 'singleton',
      payload: { data: JSON.stringify({ id: 'singleton', portrait: 'Cloud Newer', updatedAt: 6000 }) },
    });

    const res = await restoreAIDataFromCloud('user_1');

    expect(res.localStoreRecords).toBe(1);
    expect(localStore.aiPortrait.get('singleton')).toMatchObject({ portrait: 'Cloud Newer' });
  });

  // A-5 (R2-012): журнал незакрытых облачных удалений не читается — не знаем,
  // какие из облачных записей уже снесены. Вернуть удалённое хуже, чем не
  // вернуть ничего, поэтому раздел ИИ-записей пропускается целиком.
  it('skips the whole AI-store section when the pending-deletion journal is unreadable', async () => {
    localStorage.setItem('ai_sync_pending_deletes', '{обрывок без закрывающей скобки');
    localStoreRecordsDocs.push({
      store: 'aiPortrait',
      key: 'singleton',
      payload: { data: JSON.stringify({ id: 'singleton', portrait: 'Cloud Portrait', updatedAt: 6000 }) },
    });

    try {
      const res = await restoreAIDataFromCloud('user_1');

      expect(localStore.aiPortrait.size).toBe(0);
      expect(res.localStoreRecords).toBe(0);
      expect(res.sectionFailed).toBe(true);
      expect(reportError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ action: 'restoreAIData_deleteJournalUnknown', userId: 'user_1' }),
        'warning',
      );
    } finally {
      // Остальные кейсы файла читают этот же журнал — оставить его чистым.
      localStorage.removeItem('ai_sync_pending_deletes');
    }
  });

  it('restores assembled record just under MAX_RESTORE_RECORD_BYTES (AG-RESTORE-4)', async () => {    // Large synthetic payload (~9.5 MB)
    const paddingSize = 9.5 * 1024 * 1024;
    const padding = 'x'.repeat(paddingSize);
    const largeObj = { id: 'large-dlg', pad: padding, updatedAt: 3000 };
    const jsonStr = JSON.stringify(largeObj);
    const byteLen = new TextEncoder().encode(jsonStr).length;
    expect(byteLen).toBeLessThan(MAX_RESTORE_RECORD_BYTES);

    localStoreRecordsDocs.push({
      store: 'aiDialogues',
      key: 'large-dlg',
      payload: { data: jsonStr, updatedAt: 3000 },
    });

    const res = await restoreAIDataFromCloud('user_1');

    expect(res.localStoreRecords).toBe(1);
    expect(res.oversized).toBe(0);
    expect(res.failed).toBe(0);
    expect(localStore.aiDialogues.get('large-dlg')).toMatchObject({ id: 'large-dlg', pad: padding });
  });

  it('rejects record exceeding MAX_RESTORE_RECORD_BYTES, reports oversized with both numbers and never malformed (AG-RESTORE-4)', async () => {
    // Payload slightly above MAX_RESTORE_RECORD_BYTES (10 MB)
    const padding = 'y'.repeat(MAX_RESTORE_RECORD_BYTES + 1024);
    const oversizedObj = { id: 'huge-dlg', pad: padding, updatedAt: 3000 };
    const jsonStr = JSON.stringify(oversizedObj);
    const recordBytes = new TextEncoder().encode(jsonStr).length;
    expect(recordBytes).toBeGreaterThan(MAX_RESTORE_RECORD_BYTES);

    localStoreRecordsDocs.push({
      store: 'aiDialogues',
      key: 'huge-dlg',
      payload: { data: jsonStr, updatedAt: 3000 },
    });

    const res = await restoreAIDataFromCloud('user_1');

    expect(res.localStoreRecords).toBe(0);
    expect(res.oversized).toBe(1);
    expect(res.failed).toBe(0);
    expect(localStore.aiDialogues.get('huge-dlg')).toBeUndefined();

    // Verify reportError was called with warning level, recordBytes, and limit
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(new RegExp(`oversized local_store_record \\(${recordBytes} bytes, limit ${MAX_RESTORE_RECORD_BYTES} bytes\\)`)),
      }),
      { store: 'aiDialogues', key: 'huge-dlg', bytes: recordBytes, limit: MAX_RESTORE_RECORD_BYTES },
      'warning'
    );

    // Verify reportError was NEVER called with 'malformed'
    const reportCalls = vi.mocked(reportError).mock.calls;
    for (const call of reportCalls) {
      const err = call[0] as Error;
      expect(err.message).not.toContain('malformed');
    }

    // Verify logger.warn was called with size and limit
    expect(logger.warn).toHaveBeenCalledWith(
      'AIRestoreService',
      expect.stringContaining(`Record too large to restore (${recordBytes} bytes, limit ${MAX_RESTORE_RECORD_BYTES} bytes): aiDialogues/huge-dlg`)
    );
  });

  it('reports genuinely unparseable corrupted JSON as malformed (AG-RESTORE-4)', async () => {
    localStoreRecordsDocs.push({
      store: 'aiDialogues',
      key: 'corrupt-dlg',
      payload: { data: '{ "id": "corrupt-dlg", invalid-json-syntax-here', updatedAt: 3000 },
    });

    const res = await restoreAIDataFromCloud('user_1');

    expect(res.localStoreRecords).toBe(0);
    expect(res.failed).toBe(1);
    expect(res.oversized).toBe(0);
    expect(localStore.aiDialogues.get('corrupt-dlg')).toBeUndefined();

    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'restoreAIData: malformed local_store_record' }),
      { store: 'aiDialogues', key: 'corrupt-dlg' }
    );
  });

  it('restores production-shaped dialogue record (~941 KB across 2 pages) and validates checksum (AG-RESTORE-4)', async () => {
    // Production shape: ~941 KB across 2 pages (~470 KB each), paged with #0, #1
    const halfChunkSize = 470 * 1024;
    const chunk0 = '{"id":"prod-dlg","messages":["' + 'A'.repeat(halfChunkSize);
    const chunk1 = 'B'.repeat(halfChunkSize) + '"],"updatedAt":3000}';
    const fullJson = chunk0 + chunk1;
    const expectedChecksum = `hash-of:${fullJson}`;

    localStoreRecordsDocs.push({
      store: 'aiDialogues',
      key: 'prod-dlg#0',
      payload: { data: chunk0, totalPages: 2, updatedAt: 3000 },
      checksum: expectedChecksum,
    });
    localStoreRecordsDocs.push({
      store: 'aiDialogues',
      key: 'prod-dlg#1',
      payload: { data: chunk1, totalPages: 2, updatedAt: 3000 },
    });

    const res = await restoreAIDataFromCloud('user_1');

    expect(res.localStoreRecords).toBe(1);
    expect(res.oversized).toBe(0);
    expect(res.failed).toBe(0);
    expect(localStore.aiDialogues.get('prod-dlg')).toBeDefined();
    expect((localStore.aiDialogues.get('prod-dlg') as any).id).toBe('prod-dlg');
  });

  it('fails restore and logs warning when checksum does not match for paged record (AG-RESTORE-4)', async () => {
    const chunk0 = '{"id":"bad-checksum-dlg","data":"part1';
    const chunk1 = 'part2","updatedAt":3000}';

    localStoreRecordsDocs.push({
      store: 'aiDialogues',
      key: 'bad-checksum-dlg#0',
      payload: { data: chunk0, totalPages: 2, updatedAt: 3000 },
      checksum: 'hash-of:wrong-checksum-data',
    });
    localStoreRecordsDocs.push({
      store: 'aiDialogues',
      key: 'bad-checksum-dlg#1',
      payload: { data: chunk1, totalPages: 2, updatedAt: 3000 },
    });

    const res = await restoreAIDataFromCloud('user_1');

    expect(res.localStoreRecords).toBe(0);
    expect(res.failed).toBe(1);
    expect(localStore.aiDialogues.get('bad-checksum-dlg')).toBeUndefined();
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'restoreAIData: checksum mismatch' }),
      { store: 'aiDialogues', key: 'bad-checksum-dlg' }
    );
  });


  it('restores embeddings when requested during cloud restore', async () => {
    localStorage.clear();
    requestEmbeddingRestore('user_1');
    summaryDocs.push({ id: 'doc-1', data: () => ({ tone: 'calm' }) });
    embeddingDocs.push({ id: 'doc-1', data: () => ({ vectorsJson: '[[1,2,3]]', contentHash: 'h1' }) });

    const result = await restoreAIDataFromCloud('user_1');

    expect(result.summaries).toBe(1);
    expect(result.embeddings).toBe(1);
  });

  it('pulls summaries and embeddings that are missing locally', async () => {
    summaryDocs.push({ id: 'doc-1', data: () => ({ tone: 'calm' }) });
    embeddingDocs.push({ id: 'doc-1', data: () => ({}) });

    const res = await restoreAIDataFromCloud('user-a');

    expect(res).toMatchObject({ summaries: 1, embeddings: 1, failed: 0 });
    expect(localStore.aiSummaries.get('doc-1')).toBeDefined();
    expect(localStore.aiEmbeddings.get('doc-1')).toBeDefined();
  });

  // It came from the cloud, so it is already there. Leaving it unmarked makes
  // the sync loop treat every restored record as pending and upload them all.
  it('marks a restored embedding as already in the cloud', async () => {
    embeddingDocs.push({ id: 'doc-1', data: () => ({}) });

    await restoreAIDataFromCloud('user-a');

    expect(localStore.aiEmbeddings.get('doc-1')).toMatchObject({ cloudSyncedAt: expect.any(Number) });
  });

  // Repairs records restored before that flag was set — otherwise they keep
  // being re-uploaded on every pass.
  it('marks an existing local embedding whose content the cloud already holds', async () => {
    localStore.aiEmbeddings.set('local_new', { documentId: 'local_new', contentHash: 'h1', vectors: [[1]] });
    embeddingDocs.push({ id: 'old_dead_id', data: () => ({}) });
    decodeCloudEmbedding.mockResolvedValueOnce({ documentId: 'old_dead_id', contentHash: 'h1' } as never);

    const res = await restoreAIDataFromCloud('user-a');

    expect(res.markedSynced).toBe(1);
    expect(localStore.aiEmbeddings.get('local_new')).toMatchObject({ cloudSyncedAt: expect.any(Number) });
  });

  it('does not mark a local embedding the cloud does not have', async () => {
    localStore.aiEmbeddings.set('local_new', { documentId: 'local_new', contentHash: 'h-not-in-cloud', vectors: [[1]] });
    embeddingDocs.push({ id: 'other', data: () => ({}) });
    decodeCloudEmbedding.mockResolvedValueOnce({ documentId: 'other', contentHash: 'h1' } as never);

    const res = await restoreAIDataFromCloud('user-a');

    expect(res.markedSynced).toBe(0);
    expect(localStore.aiEmbeddings.get('local_new')).not.toHaveProperty('cloudSyncedAt');
  });

  // A restore must never overwrite analysis newer than the cloud copy — the
  // cloud lags local by design (writes are budgeted and paced).
  it('leaves records that already exist locally untouched', async () => {
    localStore.aiSummaries.set('doc-1', { documentId: 'doc-1', tone: 'LOCAL' });
    summaryDocs.push({ id: 'doc-1', data: () => ({ tone: 'CLOUD' }) });

    const res = await restoreAIDataFromCloud('user-a');

    expect(res.summaries).toBe(0);
    expect(localStore.aiSummaries.get('doc-1')).toEqual({ documentId: 'doc-1', tone: 'LOCAL' });
  });

  // Every decrypt would throw with the vault locked. Restoring then would burn
  // reads and mark the job done, so the caller must be told to retry.
  it('does nothing and reports skippedLocked when the vault is locked', async () => {
    getSessionKey.mockReturnValue(null as unknown as CryptoKey);
    summaryDocs.push({ id: 'doc-1', data: () => ({}) });

    const res = await restoreAIDataFromCloud('user-a');

    expect(res.skippedLocked).toBe(true);
    expect(res.summaries).toBe(0);
    expect(localStore.aiSummaries.size).toBe(0);
  });

  it('runs with encryption disabled even though there is no session key', async () => {
    getEncryptionEnabled.mockReturnValue(false);
    getSessionKey.mockReturnValue(null as unknown as CryptoKey);
    summaryDocs.push({ id: 'doc-1', data: () => ({ tone: 'calm' }) });

    const res = await restoreAIDataFromCloud('user-a');

    expect(res.skippedLocked).toBe(false);
    expect(res.summaries).toBe(1);
  });

  it('counts a record that fails to decode and keeps going', async () => {
    decodeCloudSummary.mockRejectedValueOnce(new Error('bad payload'));
    summaryDocs.push({ id: 'bad', data: () => ({}) }, { id: 'good', data: () => ({}) });

    const res = await restoreAIDataFromCloud('user-a');

    expect(res.failed).toBe(1);
    expect(res.summaries).toBe(1);
    expect(localStore.aiSummaries.get('good')).toBeDefined();
  });

  it('does nothing without a user id', async () => {
    summaryDocs.push({ id: 'doc-1', data: () => ({}) });
    const res = await restoreAIDataFromCloud('');
    expect(res).toMatchObject({ summaries: 0, embeddings: 0 });
  });

  it('LS-4: User A requests embedding restore, User B does not fetch embeddings', async () => {
    localStorage.clear();
    const { DataProvider } = await import('../../../../core/data');
    const paginatedSpy = vi.spyOn(DataProvider, 'getUserEmbeddingsPaginated');
    paginatedSpy.mockClear();

    // User A requests embedding restore
    requestEmbeddingRestore('user-A');

    // User B runs restoreAIDataFromCloud
    const resB = await restoreAIDataFromCloud('user-B');

    expect(paginatedSpy).not.toHaveBeenCalled();
    expect(resB.embeddings).toBe(0);

    // User A runs restoreAIDataFromCloud
    await restoreAIDataFromCloud('user-A');
    expect(paginatedSpy).toHaveBeenCalledWith('user-A', expect.any(Number), undefined);
  });
});

describe('reattachOrphanedAnalysis', () => {
  beforeEach(() => {
    localStore.aiSummaries = new Map();
    localStore.aiEmbeddings = new Map();
    localStore.aiTimeline = new Map();
    localStore.documents = new Map();
    latestContent.clear();
  });

  const addNote = (id: string, text: string, lastSessionAt?: number, uuid?: string) => {
    localStore.documents.set(id, { id, uuid, lastSessionAt: lastSessionAt ?? Date.parse('2026-07-01') });
    latestContent.set(id, text);
  };

  /**
   * The whole point: analysis is keyed by a per-device local id, so a note
   * downloaded again after a wipe gets a new id and its analysis is stranded.
   */
  it('adopts a stranded summary onto the note with the same text', async () => {
    addNote('local_new', 'the note text');
    localStore.aiSummaries.set('local_dead', {
      documentId: 'local_dead',
      contentHash: 'hash-of:the note text',
      tone: 'calm',
      themes: ['work'],
      extractedFacts: ['a fact'],
      insights: [],
    });

    const res = await reattachOrphanedAnalysis();

    expect(res.summaries).toBe(1);
    expect(localStore.aiSummaries.get('local_new')).toMatchObject({ documentId: 'local_new', tone: 'calm' });
    expect(localStore.aiSummaries.has('local_dead')).toBe(false);
  });

  it('rebuilds the timeline row so the life story comes back', async () => {
    addNote('local_new', 'the note text', Date.parse('2026-03-14'));
    localStore.aiSummaries.set('local_dead', {
      documentId: 'local_dead',
      contentHash: 'hash-of:the note text',
      tone: 'calm', themes: [], extractedFacts: ['a fact'], insights: [],
    });

    await reattachOrphanedAnalysis();

    expect(localStore.aiTimeline.get('local_new')).toMatchObject({
      documentId: 'local_new',
      date: '2026-03-14',
      month: '2026-03',
      facts: ['a fact'],
    });
  });

  it('adopts a stranded embedding too', async () => {
    addNote('local_new', 'the note text');
    localStore.aiEmbeddings.set('local_dead', {
      documentId: 'local_dead',
      contentHash: 'hash-of:the note text',
      vectors: [[1, 2]],
    });

    const res = await reattachOrphanedAnalysis();

    expect(res.embeddings).toBe(1);
    expect(localStore.aiEmbeddings.get('local_new')).toMatchObject({ vectors: [[1, 2]] });
  });

  // Adopting on anything looser than an exact hash would attach one note's
  // analysis to a different note — worse than having none.
  it('does not adopt when the text differs', async () => {
    addNote('local_new', 'different text');
    localStore.aiSummaries.set('local_dead', {
      documentId: 'local_dead',
      contentHash: 'hash-of:the note text',
      tone: 'calm', themes: [], extractedFacts: [], insights: [],
    });

    const res = await reattachOrphanedAnalysis();

    expect(res.summaries).toBe(0);
    expect(localStore.aiSummaries.has('local_dead')).toBe(true);
  });

  it('gives one stranded summary to only one of two identical notes', async () => {
    addNote('local_a', 'same text');
    addNote('local_b', 'same text');
    localStore.aiSummaries.set('local_dead', {
      documentId: 'local_dead',
      contentHash: 'hash-of:same text',
      tone: 'calm', themes: [], extractedFacts: [], insights: [],
    });

    const res = await reattachOrphanedAnalysis();

    expect(res.summaries).toBe(1);
    const adopted = ['local_a', 'local_b'].filter(id => localStore.aiSummaries.has(id));
    expect(adopted).toHaveLength(1);
  });

  it('leaves a note that already has its own analysis alone', async () => {
    addNote('local_new', 'the note text');
    localStore.aiSummaries.set('local_new', { documentId: 'local_new', tone: 'MINE', contentHash: 'hash-of:the note text' });
    localStore.aiSummaries.set('local_dead', {
      documentId: 'local_dead',
      contentHash: 'hash-of:the note text',
      tone: 'STRANDED', themes: [], extractedFacts: [], insights: [],
    });

    const res = await reattachOrphanedAnalysis();

    expect(res.summaries).toBe(0);
    expect(localStore.aiSummaries.get('local_new')).toMatchObject({ tone: 'MINE' });
  });

  it('returns early and hashes nothing when there are no orphans', async () => {
    addNote('local_new', 'the note text');
    const res = await reattachOrphanedAnalysis();
    expect(res).toEqual({ summaries: 0, embeddings: 0 });
  });

  it('ignores stranded analysis that has no content hash to match on', async () => {
    addNote('local_new', 'the note text');
    localStore.aiSummaries.set('local_dead', { documentId: 'local_dead', tone: 'calm' });

    const res = await reattachOrphanedAnalysis();

    expect(res.summaries).toBe(0);
  });

  // ── G4: uuid-first matching ─────────────────────────────────────────

  it('matches two notes with identical text by uuid, not by hash', async () => {
    addNote('local_a', 'same text', undefined, 'uuid-a');
    addNote('local_b', 'same text', undefined, 'uuid-b');
    localStore.aiSummaries.set('orphan_a', {
      documentId: 'orphan_a',
      documentUuid: 'uuid-a',
      contentHash: 'hash-of:same text',
      tone: 'calm', themes: [], extractedFacts: [], insights: [],
    });
    localStore.aiSummaries.set('orphan_b', {
      documentId: 'orphan_b',
      documentUuid: 'uuid-b',
      contentHash: 'hash-of:same text',
      tone: 'excited', themes: [], extractedFacts: [], insights: [],
    });

    const res = await reattachOrphanedAnalysis();

    expect(res.summaries).toBe(2);
    expect(localStore.aiSummaries.get('local_a')).toMatchObject({ tone: 'calm' });
    expect(localStore.aiSummaries.get('local_b')).toMatchObject({ tone: 'excited' });
    expect(localStore.aiSummaries.has('orphan_a')).toBe(false);
    expect(localStore.aiSummaries.has('orphan_b')).toBe(false);
  });

  it('falls back to contentHash when documentUuid is absent', async () => {
    addNote('local_new', 'the note text', undefined, 'uuid-new');
    localStore.aiSummaries.set('local_dead', {
      documentId: 'local_dead',
      // no documentUuid — legacy record
      contentHash: 'hash-of:the note text',
      tone: 'calm', themes: [], extractedFacts: [], insights: [],
    });

    const res = await reattachOrphanedAnalysis();

    expect(res.summaries).toBe(1);
    expect(localStore.aiSummaries.get('local_new')).toMatchObject({ documentId: 'local_new', tone: 'calm' });
  });

  it('does not fall back to hash when documentUuid is set but has no match', async () => {
    addNote('local_new', 'the note text', undefined, 'uuid-new');
    localStore.aiSummaries.set('local_dead', {
      documentId: 'local_dead',
      documentUuid: 'uuid-nonexistent',
      contentHash: 'hash-of:the note text',
      tone: 'calm', themes: [], extractedFacts: [], insights: [],
    });

    const res = await reattachOrphanedAnalysis();

    // documentUuid is set but doesn't match any doc → not adopted via hash either
    expect(res.summaries).toBe(0);
    expect(localStore.aiSummaries.has('local_dead')).toBe(true);
  });

  // N-39: провайдер отбрасывает чужие строки, и в странице своих меньше десяти.
  // Конец списка — по числу строк, которые отдал сервер, иначе восстановление
  // эмбеддингов объявлялось законченным на первой же такой странице.
  it('a page thinned by the owner filter does not end the embedding restore', async () => {
    localStorage.clear();
    const { DataProvider } = await import('../../../../core/data');
    const spy = vi.spyOn(DataProvider, 'getUserEmbeddingsPaginated')
      .mockResolvedValueOnce({ items: Array.from({ length: 9 }, (_, i) => ({ id: `e${i}` })), nextCursorId: 'e9', readCount: 10 })
      .mockResolvedValueOnce({ items: [], readCount: 0 });
    requestEmbeddingRestore('user-n39');
    await restoreAIDataFromCloud('user-n39');
    // Вторая страница запрошена — значит, первая, прореженная фильтром, конец не объявила.
    expect(spy.mock.calls.some(([, , cursor]) => cursor === 'e9')).toBe(true);
    spy.mockRestore();
  });
});

// ── L-5 (R4-076): привязка сироты не возвращает удалённое и не трогает
// исключённое из AI ──────────────────────────────────────────────────────

const PENDING_ANALYSIS_DELETES_KEY = 'ai_sync_pending_analysis_deletes';

describe('reattachOrphanedAnalysis — L-5 guards', () => {
  beforeEach(() => {
    localStorage.clear();
    localStore.aiSummaries = new Map();
    localStore.aiEmbeddings = new Map();
    localStore.aiTimeline = new Map();
    localStore.documents = new Map();
    latestContent.clear();
  });

  const addGuardedNote = (id: string, text: string, uuid: string, extra?: Record<string, unknown>) => {
    localStore.documents.set(id, { id, uuid, lastSessionAt: Date.parse('2026-07-01'), ...extra });
    latestContent.set(id, text);
  };

  const seedOrphan = (key: string, uuid: string) => {
    localStore.aiSummaries.set(key, {
      documentId: key,
      ...(uuid ? { documentUuid: uuid } : {}),
      contentHash: 'hash-of:the note text',
      tone: 'calm', themes: [], extractedFacts: [], insights: [],
    });
  };

  it('a summary whose uuid is in pending analysis deletes is not attached', async () => {
    localStorage.setItem(PENDING_ANALYSIS_DELETES_KEY, JSON.stringify([
      { uid: 'u_reattach', canonicalId: 'note-uuid-1' },
    ]));
    addGuardedNote('local_new', 'the note text', 'note-uuid-1');
    seedOrphan('local_dead', 'note-uuid-1');

    const res = await reattachOrphanedAnalysis();

    expect(res.summaries).toBe(0);
    expect(localStore.aiSummaries.has('local_dead')).toBe(true);
    expect(localStore.aiSummaries.has('local_new')).toBe(false);
  });

  it('a summary is not attached to a note excluded from AI', async () => {
    addGuardedNote('local_new', 'the note text', 'note-uuid-2', { excludedFromAI: true });
    seedOrphan('local_dead', 'note-uuid-2');

    const res = await reattachOrphanedAnalysis();

    expect(res.summaries).toBe(0);
    expect(localStore.aiSummaries.has('local_dead')).toBe(true);
    expect(localStore.aiSummaries.has('local_new')).toBe(false);
  });

  it('an unreadable delete-journal skips the whole pass (fail-closed)', async () => {
    localStorage.setItem(PENDING_ANALYSIS_DELETES_KEY, '{corrupt');
    addGuardedNote('local_new', 'the note text', 'note-uuid-3');
    seedOrphan('local_dead', 'note-uuid-3');

    const res = await reattachOrphanedAnalysis();

    expect(res.summaries).toBe(0);
    expect(localStore.aiSummaries.has('local_dead')).toBe(true);
    expect(localStore.aiSummaries.has('local_new')).toBe(false);
  });
});
