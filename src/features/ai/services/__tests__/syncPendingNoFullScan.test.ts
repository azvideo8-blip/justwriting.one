import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIEmbeddingService, markCloudFresh } from '../AIEmbeddingService';

vi.mock('../../../../core/auth', () => ({
  getCurrentUser: vi.fn(() => ({ uid: 'u1' })),
}));
vi.mock('../../../../core/data', () => ({
  DataProvider: {
    saveEmbedding: vi.fn(async () => undefined),
  },
}));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  maybeEncrypt: vi.fn(async (doc: Record<string, unknown>) => ({ ...doc, _encrypted: true })),
  maybeDecrypt: vi.fn(async (doc: Record<string, unknown>) => doc),
  getEncryptionEnabled: vi.fn(() => false),
}));
vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({
  cloudSyncEnabled: vi.fn(() => true),
}));

// Инструментированная fake-IDB: считаем «тяжёлые» чтения — записи, у которых
// в руках оказался векторный payload. Проход не должен читать свежие записи
// целиком; свежесть берётся из реестра (localStorage).
let embeddingRows: Map<string, Record<string, unknown>>;
let deserializedCount: number;

vi.mock('../../../../core/storage/localDb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../core/storage/localDb')>();
  return {
    ...actual,
    getLocalDb: vi.fn(async () => ({
      getAllKeys: async (_s: string) => [...embeddingRows.keys()],
      get: async (_s: string, k: string) => {
        const row = embeddingRows.get(k);
        if (row && Array.isArray(row.vectors)) deserializedCount++;
        return row;
      },
      getAll: async (_s: string) => {
        // Полное чтение — то, чего быть не должно: тянет все векторы разом.
        for (const row of embeddingRows.values()) {
          if (Array.isArray(row.vectors)) deserializedCount++;
        }
        return [...embeddingRows.values()];
      },
      put: async (_s: string, v: Record<string, unknown>) => {
        embeddingRows.set(v.documentId as string, v);
      },
    })),
  };
});

const fresh = (id: string) => ({
  documentId: id, cloudSyncedAt: Date.now(), vectors: [[0.1]], vectorsJson: '[[0.1]]',
  chunkTexts: [], chunkTextsJson: '[]', model: 'm', dim: 2, contentHash: 'h', processedAt: 1,
});
const stale = (id: string) => ({
  documentId: id, vectors: [[0.2]], vectorsJson: '[[0.2]]',
  chunkTexts: [], chunkTextsJson: '[]', model: 'm', dim: 2, contentHash: 'h', processedAt: 1,
});

describe('syncPendingToCloud — чтение пропорционально устаревшим (AUD-8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deserializedCount = 0;
    embeddingRows = new Map();
    localStorage.clear();
  });

  it('свежие по реестру записи не читаются вовсе, устаревшие — выгружаются', async () => {
    for (let i = 0; i < 200; i++) embeddingRows.set(`d${i}`, fresh(`d${i}`));
    embeddingRows.set('stale1', stale('stale1'));
    embeddingRows.set('stale2', stale('stale2'));
    // Свежесть уже известна (обычный случай после первого прохода/выгрузки).
    for (let i = 0; i < 200; i++) markCloudFresh(`d${i}`);

    const res = await AIEmbeddingService.syncPendingToCloud();

    expect(res.pending).toBe(2);
    expect(res.synced).toBe(2);
    // Векторный payload оказался в руках только у 2 устаревших записей.
    expect(deserializedCount).toBe(2);
  });

  it('нет устаревших — ни один векторный payload не читается', async () => {
    for (let i = 0; i < 50; i++) {
      embeddingRows.set(`d${i}`, fresh(`d${i}`));
      markCloudFresh(`d${i}`);
    }
    const res = await AIEmbeddingService.syncPendingToCloud();
    expect(res.pending).toBe(0);
    expect(deserializedCount).toBe(0);
  });

  it('после выгрузки запись попадает в реестр и на следующем проходе не читается', async () => {
    embeddingRows.set('stale1', stale('stale1'));

    const first = await AIEmbeddingService.syncPendingToCloud();
    expect(first.synced).toBe(1);

    deserializedCount = 0;
    const second = await AIEmbeddingService.syncPendingToCloud();
    expect(second.pending).toBe(0);
    expect(deserializedCount).toBe(0);
  });

  it('save() при недоступном облаке снимает пометку свежести: заметка снова выгружается', async () => {
    // Облако падает (не oversized, не ENCRYPT_REQUIRED) — выгрузки нет,
    // свежесть не восстанавливается.
    vi.mocked((await import('../../../../core/data')).DataProvider.saveEmbedding)
      .mockRejectedValueOnce(new Error('network down'));
    embeddingRows.set('doc1', fresh('doc1'));
    markCloudFresh('doc1');

    await AIEmbeddingService.save(stale('doc1') as never);

    deserializedCount = 0;
    const res = await AIEmbeddingService.syncPendingToCloud();
    expect(res.pending).toBeGreaterThanOrEqual(1);
    expect(deserializedCount).toBeGreaterThanOrEqual(1);
  });
});
