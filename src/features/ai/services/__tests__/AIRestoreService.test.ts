import { describe, it, expect, vi, beforeEach } from 'vitest';

const localStore: { aiSummaries: Map<string, unknown>; aiEmbeddings: Map<string, unknown> } = {
  aiSummaries: new Map(),
  aiEmbeddings: new Map(),
};
type StoreName = keyof typeof localStore;

vi.mock('../../../../core/storage/localDb', () => ({
  getLocalDb: vi.fn(async () => ({
    getAllKeys: async (store: StoreName) => [...localStore[store].keys()],
    put: async (store: StoreName, value: { documentId: string }) => {
      localStore[store].set(value.documentId, value);
    },
  })),
}));

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

import { restoreAIDataFromCloud } from '../AIRestoreService';

describe('restoreAIDataFromCloud', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStore.aiSummaries = new Map();
    localStore.aiEmbeddings = new Map();
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
