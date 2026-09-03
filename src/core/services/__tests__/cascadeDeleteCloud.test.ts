import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Удаление заметки уносит её производные ИИ и из облака, а не только с
 * устройства.
 *
 * Пока сводок в облаке было 26 из 166, дыра была незаметна. После того как
 * выгрузка починена и там лежит весь архив, локального удаления мало:
 * восстановление из облака вернуло бы разбор удалённой заметки обратно — то
 * есть «удалил» означало бы «спрятал до следующей переустановки».
 *
 * Ключ облачной строки — ПОСТОЯННЫЙ номер заметки: политика доступа сверяет
 * его с documents.uuid, и по локальному `local_…` не удалится ничего.
 */

const deleteSummary = vi.fn().mockResolvedValue(undefined);
const deleteEmbedding = vi.fn().mockResolvedValue(undefined);
const scheduleStoreDelete = vi.fn();

const CANON = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

vi.mock('../../data', () => ({ DataProvider: { deleteSummary, deleteEmbedding } }));
vi.mock('../../auth', () => ({ getCurrentUser: () => ({ uid: 'user-1' }) }));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../facetLock', () => ({ withFacetLock: async (fn: () => Promise<void>) => fn() }));
vi.mock('../LocalStoreSyncService', () => ({
  LocalStoreSyncService: { scheduleStoreDelete, scheduleStoreSync: vi.fn() },
}));
vi.mock('../../storage/localDb', () => ({
  randomUUID: () => 'uuid',
  getLocalDb: vi.fn(async () => ({
    get: vi.fn(async (store: string) =>
      (store === 'documents' ? { id: 'local_1', uuid: CANON } : undefined)),
    getAll: vi.fn(async () => []),
    getAllFromIndex: vi.fn(async () => []),
    delete: vi.fn(async () => undefined),
    put: vi.fn(async () => undefined),
    transaction: vi.fn(() => ({
      store: { delete: vi.fn(), put: vi.fn() },
      objectStore: () => ({ delete: vi.fn(), put: vi.fn() }),
      done: Promise.resolve(),
    })),
  })),
}));

const { LocalDocumentService } = await import('../LocalDocumentService');

describe('cascadeDeleteAIDerivatives — облачные копии', () => {
  beforeEach(() => vi.clearAllMocks());

  it('сносит облачные сводку и вектор по постоянному номеру заметки', async () => {
    await LocalDocumentService.cascadeDeleteAIDerivatives('local_1');

    expect(deleteSummary).toHaveBeenCalledWith('user-1', CANON);
    expect(deleteEmbedding).toHaveBeenCalledWith('user-1', CANON);
  });

  it('ставит в очередь удаление хроники — она живёт в общем хранилище записей', async () => {
    await LocalDocumentService.cascadeDeleteAIDerivatives('local_1');

    expect(scheduleStoreDelete).toHaveBeenCalledWith('aiTimeline', 'local_1');
  });
});
