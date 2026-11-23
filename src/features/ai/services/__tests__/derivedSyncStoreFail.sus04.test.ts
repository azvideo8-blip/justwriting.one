// NB-14 (sus04), второй вход: полный проход выгрузки производных
// (syncAllDerivedData, зовётся в т.ч. при смене аккаунта) обязан пронести
// failed сторов в stores.failed и totalFailed — иначе отказ чтения стора
// не виден в итоге прохода. Харнесс — из derivativesLocalOnly.test.ts;
// LocalStoreSyncService здесь край (мок), проход производных настоящий.
// Мутация: убрать result.stores.failed = storesRes.failed — красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u1' }) }));
vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  maybeEncrypt: async (p: Record<string, unknown>) => p,
  maybeDecrypt: async (p: Record<string, unknown>) => p,
  getEncryptionEnabled: () => false,
  DecryptionError: class extends Error {},
}));
vi.mock('../../../../core/crypto/encrypt', () => ({ getSessionKey: () => null }));
vi.mock('../../../../core/data', () => ({
  DataProvider: {
    saveSummary: async () => undefined,
    saveEmbedding: async () => undefined,
    countSummaries: async () => 0,
    countEmbeddings: async () => 0,
    countLocalStoreRecords: async () => 0,
    getUserDocuments: async () => [],
    listSummaryDocumentIds: async () => [],
    listEmbeddingDocumentIds: async () => [],
    listTombstonedDocumentUuids: async () => [],
  },
}));
vi.mock('../../../../core/services/LocalStoreSyncService', () => ({
  LocalStoreSyncService: {
    syncAllLocalStores: async () => ({ synced: 3, failed: 2, skippedLocked: false, skippedOversized: 0 }),
    scheduleStoreSync: vi.fn(),
  },
  SUPPORTED_LOCAL_STORES: [],
  getLocalStoreRecordCounts: async () => 0,
}));

const { AIDerivedDataSyncService } = await import('../AIDerivedDataSyncService');

beforeEach(() => localStorage.clear());

describe('NB-14: отказ сторов виден в итоге полного прохода', () => {
  it('stores.failed и totalFailed несут отказ чтения стора', async () => {
    const res = await AIDerivedDataSyncService.syncAllDerivedData('u1');
    expect(res.stores.failed).toBe(2);
    expect(res.stores.synced).toBe(3);
    expect(res.totalFailed).toBe(2);
    expect(res.totalSynced).toBe(3);
  });
});