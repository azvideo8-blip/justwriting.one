import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

/**
 * Уборка производных, за которыми не осталось заметки.
 *
 * Главное свойство здесь не «удаляет», а «не удаляет лишнего». «Заметки нет на
 * устройстве» и «заметки нет вообще» — разные вещи: на втором устройстве
 * локально лежит только часть архива. Уборка по одному локальному признаку
 * снесла бы разборы живых заметок, и восстановить их было бы неоткуда.
 */

const getUserDocuments = vi.fn();

vi.mock('../../../../core/data', () => ({ DataProvider: { getUserDocuments } }));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({ getEncryptionEnabled: () => false }));
vi.mock('../../../../core/crypto/encrypt', () => ({ getSessionKey: () => null }));
vi.mock('../../../../core/services/LocalStoreSyncService', () => ({
  LocalStoreSyncService: { syncAllLocalStores: vi.fn() },
  getLocalStoreRecordCounts: vi.fn(async () => 0),
}));
vi.mock('../AISummaryService', () => ({ saveSummaryToCloud: vi.fn() }));
vi.mock('../AIEmbeddingService', () => ({ saveEmbeddingToCloud: vi.fn() }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const { AIDerivedDataSyncService } = await import('../AIDerivedDataSyncService');
const { getLocalDb } = await import('../../../../core/storage/localDb');

const CLOUD_ONLY = 'cccccccc-1111-4222-8333-444444444444';
const LOCAL_AND_CLOUD = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const GHOST = 'ffffffff-9999-4888-8777-666666666666';

async function seed() {
  const db = await getLocalDb('user-1');
  for (const store of ['documents', 'aiSummaries', 'aiEmbeddings'] as const) {
    for (const r of await db.getAll(store)) {
      await db.delete(store, (r as { id?: string; documentId?: string }).id
        ?? (r as { documentId: string }).documentId);
    }
  }
  await db.put('documents', {
    id: 'local_1', uuid: LOCAL_AND_CLOUD, guestId: 'u1', title: 'Живая',
    currentVersion: 1, totalWords: 1, totalDuration: 0, sessionsCount: 1,
    firstSessionAt: 1, lastSessionAt: 1, tags: [],
  } as never);

  const summary = (documentId: string, documentUuid?: string) => ({
    documentId, ...(documentUuid ? { documentUuid } : {}),
    tone: 'ровный', frequentWords: [], insights: [], themes: [],
    extractedFacts: [], processedAt: 1, contentHash: 'h',
  });
  await db.put('aiSummaries', summary('local_1', LOCAL_AND_CLOUD) as never);
  await db.put('aiSummaries', summary(CLOUD_ONLY) as never);
  await db.put('aiSummaries', summary(GHOST) as never);
  await db.put('aiEmbeddings', {
    documentId: GHOST, vectors: [[0.1]], chunkTexts: [], model: 'm', dim: 1,
    contentHash: 'h', processedAt: 1, schemaV: 3,
  } as never);
}

describe('уборка производных без заметки', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await seed();
  });

  /**
   * CLOUD_ONLY — заметка, которой нет на этом устройстве, но она жива в облаке.
   * Её разбор трогать нельзя.
   */
  it('сиротой считается только то, чего нет ни здесь, ни в облаке', async () => {
    getUserDocuments.mockResolvedValue([{ uuid: LOCAL_AND_CLOUD }, { uuid: CLOUD_ONLY }]);

    const survey = await AIDerivedDataSyncService.findOrphanedDerivatives('user-1');

    expect(survey.cloudChecked).toBe(true);
    expect(survey.summaries).toEqual([GHOST]);
    expect(survey.embeddings).toEqual([GHOST]);
  });

  it('при недоступном облаке не находит ничего — вывод о сиротстве делать не на чем', async () => {
    getUserDocuments.mockRejectedValue(new Error('network'));

    const survey = await AIDerivedDataSyncService.findOrphanedDerivatives('user-1');

    expect(survey).toEqual({ summaries: [], embeddings: [], cloudChecked: false });
  });

  it('убирает только сирот, живые разборы остаются', async () => {
    getUserDocuments.mockResolvedValue([{ uuid: LOCAL_AND_CLOUD }, { uuid: CLOUD_ONLY }]);

    const removed = await AIDerivedDataSyncService.deleteOrphanedDerivatives('user-1');

    expect(removed).toEqual({ summaries: 1, embeddings: 1 });

    const db = await getLocalDb('user-1');
    const left = (await db.getAll('aiSummaries')).map(r => r.documentId).sort();
    expect(left).toEqual(['local_1', CLOUD_ONLY].sort());
  });

  it('при недоступном облаке не удаляет ничего', async () => {
    getUserDocuments.mockRejectedValue(new Error('network'));

    const removed = await AIDerivedDataSyncService.deleteOrphanedDerivatives('user-1');

    expect(removed).toEqual({ summaries: 0, embeddings: 0 });
    const db = await getLocalDb('user-1');
    expect(await db.count('aiSummaries')).toBe(3);
  });

  /**
   * Отдельная проверка самой защиты в удалении, а не её следствия. Сейчас
   * опись при недоступном облаке и так возвращает пустоту, поэтому снятие
   * этой ветки ничего не ломало — то есть защита не проверялась ничем. Здесь
   * опись подменена: она отдаёт кандидатов и говорит, что сверки не было.
   */
  it('не удаляет по неподтверждённой описи, даже если та принесла кандидатов', async () => {
    const spy = vi.spyOn(AIDerivedDataSyncService, 'findOrphanedDerivatives')
      .mockResolvedValue({ summaries: [GHOST], embeddings: [GHOST], cloudChecked: false });

    const removed = await AIDerivedDataSyncService.deleteOrphanedDerivatives('user-1');

    expect(removed).toEqual({ summaries: 0, embeddings: 0 });
    const db = await getLocalDb('user-1');
    expect(await db.count('aiSummaries')).toBe(3);
    spy.mockRestore();
  });

  it('гостю уборка недоступна: у него нет облака, с которым сверяться', async () => {
    const survey = await AIDerivedDataSyncService.findOrphanedDerivatives('guest_abc');

    expect(survey.cloudChecked).toBe(false);
    expect(getUserDocuments).not.toHaveBeenCalled();
  });
});
