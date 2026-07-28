import { describe, it, expect, vi, beforeEach } from 'vitest';

const localStore: {
  aiSummaries: Map<string, unknown>;
  aiEmbeddings: Map<string, unknown>;
  aiTimeline: Map<string, unknown>;
  documents: Map<string, unknown>;
} = {
  aiSummaries: new Map(),
  aiEmbeddings: new Map(),
  aiTimeline: new Map(),
  documents: new Map(),
};
type StoreName = keyof typeof localStore;

vi.mock('../../../../core/storage/localDb', () => ({
  getLocalDb: vi.fn(async () => ({
    getAllKeys: async (store: StoreName) => [...localStore[store].keys()],
    getAll: async (store: StoreName) => [...localStore[store].values()],
    put: async (store: StoreName, value: { documentId?: string; id?: string }) => {
      localStore[store].set((value.documentId ?? value.id)!, value);
    },
    delete: async (store: StoreName, key: string) => {
      localStore[store].delete(key);
    },
  })),
}));

const latestContent = new Map<string, string>();
vi.mock('../../utils/embeddingIndexer', () => ({
  sha256Hex: async (text: string) => `hash-of:${text}`,
  getLatestContent: async (id: string) => latestContent.get(id) ?? null,
}));

vi.mock('../AIThemeLedgerService', () => ({ enqueuePendingThemeTouch: vi.fn() }));

const summaryDocs: Array<{ id: string; data: () => unknown }> = [];
const embeddingDocs: Array<{ id: string; data: () => unknown }> = [];

vi.mock('../../../../core/firebase/firestoreClient', () => ({
  getClient: vi.fn(async () => ({
    db: {},
    mod: {
      collection: (_db: unknown, _u: string, _uid: string, name: string) => name,
      getDocs: async (name: string) => ({
        docs: name === 'summaries' ? summaryDocs : embeddingDocs,
      }),
    },
  })),
}));

const getSessionKey = vi.fn(() => ({} as CryptoKey));
vi.mock('../../../../core/crypto/encrypt', () => ({ getSessionKey: () => getSessionKey() }));

const getEncryptionEnabled = vi.fn((_uid: string) => true);
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: (uid: string) => getEncryptionEnabled(uid),
}));

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/errors/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

const decodeCloudSummary = vi.fn(async (d: Record<string, unknown>, id: string) => ({ documentId: id, tone: d.tone }));
vi.mock('../AISummaryService', () => ({
  decodeCloudSummary: (d: Record<string, unknown>, id: string) => decodeCloudSummary(d, id),
}));

const decodeCloudEmbedding = vi.fn(async (_d: Record<string, unknown>, id: string) => ({ documentId: id, vectors: [[1]] }));
vi.mock('../AIEmbeddingService', () => ({
  decodeCloudEmbedding: (d: Record<string, unknown>, id: string) => decodeCloudEmbedding(d, id),
}));

import { restoreAIDataFromCloud, reattachOrphanedAnalysis } from '../AIRestoreService';

describe('restoreAIDataFromCloud', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStore.aiSummaries = new Map();
    localStore.aiEmbeddings = new Map();
    localStore.aiTimeline = new Map();
    localStore.documents = new Map();
    latestContent.clear();
    summaryDocs.length = 0;
    embeddingDocs.length = 0;
    getSessionKey.mockReturnValue({} as CryptoKey);
    getEncryptionEnabled.mockReturnValue(true);
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
    expect(decodeCloudSummary).not.toHaveBeenCalled();
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
});

describe('reattachOrphanedAnalysis', () => {
  beforeEach(() => {
    localStore.aiSummaries = new Map();
    localStore.aiEmbeddings = new Map();
    localStore.aiTimeline = new Map();
    localStore.documents = new Map();
    latestContent.clear();
  });

  const addNote = (id: string, text: string, lastSessionAt?: number) => {
    localStore.documents.set(id, { id, lastSessionAt: lastSessionAt ?? Date.parse('2026-07-01') });
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
});
