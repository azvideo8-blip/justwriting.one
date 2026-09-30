import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

/**
 * drift-1, задача 2: «на устройстве / в облаке» по трём семействам производных.
 *
 * Выгрузка сводок молча не работала полгода, и заметить это было нечем: ничто
 * не сравнивало «сколько на устройстве» с «сколько в облаке». Здесь проверяется
 * три свойства сверки:
 *  1. на устройстве считаются только ОТПРАВЛЯЕМЫЕ записи — иначе разборы
 *     удалённых заметок дают вечное расхождение, и панель перестают читать;
 *  2. «отправляемо» — то же правило, по которому решает сама выгрузка;
 *  3. «не удалось посчитать» не выглядит нулём (K-4/N-85).
 */

const saveSummary = vi.fn().mockResolvedValue(undefined);
const saveEmbedding = vi.fn().mockResolvedValue(undefined);
const countSummaries = vi.fn();
const countEmbeddings = vi.fn();
const countLocalStoreRecords = vi.fn();
const storeCounts = vi.fn();

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
    saveSummary: (...a: unknown[]) => saveSummary(...a),
    saveEmbedding: (...a: unknown[]) => saveEmbedding(...a),
    countSummaries: (...a: unknown[]) => countSummaries(...a),
    countEmbeddings: (...a: unknown[]) => countEmbeddings(...a),
    countLocalStoreRecords: (...a: unknown[]) => countLocalStoreRecords(...a),
  },
}));
vi.mock('../../../../core/services/LocalStoreSyncService', () => ({
  LocalStoreSyncService: {
    syncAllLocalStores: async () => ({ synced: 0, failed: 0, skippedLocked: false, skippedOversized: 0 }),
    scheduleStoreSync: vi.fn(),
  },
  SUPPORTED_LOCAL_STORES: ['aiDialogues', 'aiBeliefs'],
  getLocalStoreRecordCounts: () => storeCounts(),
}));

const localDb = await import('../../../../core/storage/localDb');
const { AIDerivedDataSyncService } = await import('../AIDerivedDataSyncService');
const { reportError } = await import('../../../../shared/errors/reportError');

const U = (n: number) => `aaaaaaaa-bbbb-4ccc-8ddd-${String(n).padStart(12, '0')}`;

const summary = (documentId: string, documentUuid?: string) => ({
  documentId, ...(documentUuid ? { documentUuid } : {}),
  tone: 'ровный', frequentWords: [], insights: [], themes: [],
  extractedFacts: [], processedAt: 1, contentHash: 'h',
});
const embedding = (documentId: string, extra: Record<string, unknown> = {}) => ({
  documentId, vectors: [[0.1]], chunkTexts: [], model: 'm', dim: 1,
  contentHash: 'h', processedAt: 1, schemaV: 3, ...extra,
});
const note = (id: string, extra: Record<string, unknown> = {}) => ({
  id, guestId: 'u1', title: '', currentVersion: 1, totalWords: 1, totalDuration: 0,
  sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [], ...extra,
});

async function seed() {
  const db = await localDb.getLocalDb('u1');
  for (const store of ['documents', 'aiSummaries', 'aiEmbeddings'] as const) {
    for (const r of await db.getAll(store)) {
      await db.delete(store, (r as { id?: string; documentId?: string }).id
        ?? (r as { documentId: string }).documentId);
    }
  }
  // Три заметки доступны ИИ, четвёртая в корзине.
  await db.put('documents', note('local_1', { uuid: U(1) }) as never);
  await db.put('documents', note('local_2') as never); // ещё без постоянного номера
  await db.put('documents', note('local_3', { uuid: U(3) }) as never);
  await db.put('documents', note('local_4', { uuid: U(4), trashedAt: 5 }) as never);

  await db.put('aiSummaries', summary('local_1') as never);        // номер даст заметка
  await db.put('aiSummaries', summary(U(9), U(9)) as never);        // номер свой (заметка на другом устройстве)
  await db.put('aiSummaries', summary('local_2') as never);        // у заметки номера нет
  await db.put('aiSummaries', summary('local_gone') as never);     // заметки нет

  await db.put('aiEmbeddings', embedding('local_1') as never);
  await db.put('aiEmbeddings', embedding('local_gone') as never);
  await db.put('aiEmbeddings', embedding('local_3', { cloudSkipped: true }) as never); // не влез в облако
}

describe('drift-1: derived data, device vs cloud', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await seed();
    countSummaries.mockResolvedValue(166);
    countEmbeddings.mockResolvedValue(37);
    countLocalStoreRecords.mockResolvedValue(258);
    storeCounts.mockResolvedValue(260);
  });

  it('counts only sendable records on the device and names the rest separately', async () => {
    const drift = await AIDerivedDataSyncService.getDerivedDrift('u1');

    expect(drift).toEqual({
      notes: 3,
      summaries: { local: 2, cloud: 166, orphaned: 2 },
      embeddings: { local: 1, cloud: 37, orphaned: 1, oversized: 1 },
      stores: { local: 260, cloud: 258 },
    });
    expect(countLocalStoreRecords).toHaveBeenCalledWith('u1', ['aiDialogues', 'aiBeliefs']);
    expect(reportError).not.toHaveBeenCalled();
  });

  /**
   * Панель и выгрузка обязаны решать одинаково. Проверяется не общим импортом,
   * а исходом: каждую запись отдаём настоящей выгрузке и сравниваем, что она
   * приняла и что отклонила как NO_CANONICAL_ID, с числами панели.
   * Испытано снятием: панель, считающая отправляемым только свой documentUuid,
   * и выгрузка, забывшая про номер заметки, — обе красные.
   */
  it('agrees with the real upload about what is sendable', async () => {
    const drift = await AIDerivedDataSyncService.getDerivedDrift('u1');
    // Выгрузка запоминает найденный номер в записи — сверку снимаем до неё.
    const res = await AIDerivedDataSyncService.syncAllDerivedData('u1');

    expect(saveSummary).toHaveBeenCalledTimes(drift.summaries.local!);
    expect(res.summaries.orphaned).toBe(drift.summaries.orphaned);
    expect(res.embeddings.orphaned).toBe(drift.embeddings.orphaned);
    // Вектор с пометкой «не влез» выгрузка пробует заново — он мал и уезжает;
    // по правилу номера он отправляем, и панель не зовёт его сиротой.
    expect(saveEmbedding).toHaveBeenCalledTimes(drift.embeddings.local! + drift.embeddings.oversized!);
  });

  // K-4/N-85: отказ IndexedDB раньше читался как «производных нет».
  it('says "could not count" for the device when IndexedDB fails — never 0', async () => {
    const spy = vi.spyOn(localDb, 'getLocalDb').mockRejectedValue(new Error('idb broken'));
    storeCounts.mockResolvedValue(null);
    try {
      const drift = await AIDerivedDataSyncService.getDerivedDrift('u1');

      expect(drift.notes).toBeNull();
      expect(drift.summaries).toEqual({ local: null, cloud: 166, orphaned: null });
      expect(drift.embeddings).toEqual({ local: null, cloud: 37, orphaned: null, oversized: null });
      expect(drift.stores).toEqual({ local: null, cloud: 258 });
      expect(reportError).toHaveBeenCalledTimes(1);
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'idb broken' }),
        expect.objectContaining({ action: 'getDerivedDrift_local' }),
        'warning',
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('says "could not count" for a family whose cloud read failed, and keeps the others', async () => {
    countEmbeddings.mockRejectedValue(new Error('network'));

    const drift = await AIDerivedDataSyncService.getDerivedDrift('u1');

    expect(drift.embeddings.cloud).toBeNull();
    expect(drift.embeddings.local).toBe(1);
    expect(drift.summaries.cloud).toBe(166);
    expect(drift.stores.cloud).toBe(258);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'network' }),
      expect.objectContaining({ action: 'getDerivedDrift_cloudEmbeddings' }),
      'warning',
    );
  });
});
