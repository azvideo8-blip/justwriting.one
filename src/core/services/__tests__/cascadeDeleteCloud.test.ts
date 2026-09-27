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
vi.mock('../facetLock', () => ({
  withFacetLock: async (fn: () => Promise<void>) => fn(),
  // Без этого шаги 7–8 уборки (грани профиля, убеждения) падали в заглушке
  // молча и не исполнялись ни в одном тесте этого файла — видно стало, когда
  // уборка начала сообщать о сбоях (N-51).
  writeFacetStore: async (fn: (store: unknown) => Promise<void>) => fn({
    getAll: async () => [],
    transaction: () => ({ store: { delete: async () => undefined, put: async () => undefined }, done: Promise.resolve() }),
  }),
}));
vi.mock('../LocalStoreSyncService', () => ({
  LocalStoreSyncService: { scheduleStoreDelete, scheduleStoreSync: vi.fn() },
}));
/**
 * Заглушка ведёт себя как настоящая база: удалённая заметка перестаёт читаться.
 * Прежняя отдавала документ ВСЕГДА — и поэтому не могла увидеть, что в проде
 * уборка вызывается уже ПОСЛЕ удаления и читает undefined.
 */
const docs = new Map<string, { id: string; uuid?: string; guestId?: string }>();

vi.mock('../../storage/localDb', () => ({
  randomUUID: () => 'uuid',
  getLocalDb: vi.fn(async () => ({
    get: vi.fn(async (store: string, id: string) =>
      (store === 'documents' ? docs.get(id) : undefined)),
    getAll: vi.fn(async () => []),
    getAllFromIndex: vi.fn(async () => []),
    delete: vi.fn(async (store: string, id: string) => {
      if (store === 'documents') docs.delete(id);
    }),
    put: vi.fn(async () => undefined),
    count: vi.fn(async () => 0),
    transaction: vi.fn(() => ({
      store: { delete: vi.fn(), put: vi.fn(), get: vi.fn(async () => undefined) },
      objectStore: (name: string) => ({
        delete: async (id: string) => { if (name === 'documents') docs.delete(id); },
        put: vi.fn(),
        get: async (id: string) => (name === 'documents' ? docs.get(id) : undefined),
        // Удаление заметки теперь чистит и очередь синхронизации (LIFE-4),
        // поэтому заглушка обязана уметь читать её целиком.
        getAll: async () => [],
        index: () => ({ getAll: async () => [] }),
      }),
      done: Promise.resolve(),
    })),
  })),
}));

const { LocalDocumentService } = await import('../LocalDocumentService');

describe('cascadeDeleteAIDerivatives — облачные копии', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    docs.clear();
    docs.set('local_1', { id: 'local_1', uuid: CANON, guestId: 'user-1' });
  });

  it('сносит облачные сводку и вектор по постоянному номеру заметки', async () => {
    await LocalDocumentService.cascadeDeleteAIDerivatives('local_1');

    expect(deleteSummary).toHaveBeenCalledWith('user-1', CANON);
    expect(deleteEmbedding).toHaveBeenCalledWith('user-1', CANON);
  });

  it('ставит в очередь удаление хроники — она живёт в общем хранилище записей', async () => {
    await LocalDocumentService.cascadeDeleteAIDerivatives('local_1');

    expect(scheduleStoreDelete).toHaveBeenCalledWith('aiTimeline', 'local_1');
  });

  /**
   * Проверка НАСТОЯЩЕГО пути: удаление заметки, а не уборка в отрыве от него.
   *
   * deleteDocument сносит строку заметки и только потом зовёт уборку — то есть
   * достать uuid изнутри уборки уже нельзя. Прежний тест звал уборку напрямую
   * и подсовывал ей живой документ, поэтому не видел ничего.
   */
  it('удаление заметки сносит облачные копии по постоянному номеру', async () => {
    await LocalDocumentService.deleteDocument('local_1');

    expect(deleteSummary).toHaveBeenCalledWith('user-1', CANON);
    expect(deleteEmbedding).toHaveBeenCalledWith('user-1', CANON);
  });

  // N-51: облачную сводку удалить не удалось — удаление заметки об этом
  // сообщает, а не рапортует полный успех.
  it('reports when a cloud derivative could not be deleted', async () => {
    deleteSummary.mockRejectedValueOnce(new Error('offline'));
    expect(await LocalDocumentService.deleteDocument('local_1')).toBe(false);
  });

  it('reports success when everything is gone', async () => {
    expect(await LocalDocumentService.deleteDocument('local_1')).toBe(true);
  });

  // N-64: когда нет канонического uuid, удаление возвращает false (fail)
  it('N-64: returns false when canonical uuid is missing', async () => {
    docs.set('local_no_uuid', { id: 'local_no_uuid', guestId: 'user-1' });
    expect(await LocalDocumentService.deleteDocument('local_no_uuid')).toBe(false);
  });

  // N-65: удаление облачных производных для гостя или чужого владельца возвращает false
  it('N-65: returns false when owner is guest or missing for cloud derivatives', async () => {
    docs.set('local_guest_doc', { id: 'local_guest_doc', uuid: CANON, guestId: 'guest_123' });
    expect(await LocalDocumentService.deleteDocument('local_guest_doc')).toBe(false);
  });
});
