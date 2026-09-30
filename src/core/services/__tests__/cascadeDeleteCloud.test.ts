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
const reportError = vi.fn();
vi.mock('../../../shared/errors/reportError', () => ({ reportError }));
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
const docs = new Map<string, { id: string; uuid?: string; guestId?: string; linkedCloudId?: string }>();

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
    docs.set('local_1', { id: 'local_1', uuid: CANON, guestId: 'user-1', linkedCloudId: CANON });
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
    await LocalDocumentService.deleteDocument('local_1', undefined, { remove: true });

    expect(deleteSummary).toHaveBeenCalledWith('user-1', CANON);
    expect(deleteEmbedding).toHaveBeenCalledWith('user-1', CANON);
  });

  // N-51: облачную сводку удалить не удалось — удаление заметки об этом
  // сообщает, а не рапортует полный успех.
  it('reports when a cloud derivative could not be deleted', async () => {
    deleteSummary.mockRejectedValueOnce(new Error('offline'));
    expect(await LocalDocumentService.deleteDocument('local_1', undefined, { remove: true })).toBe(false);
  });

  it('reports success when everything is gone', async () => {
    expect(await LocalDocumentService.deleteDocument('local_1', undefined, { remove: true })).toBe(true);
  });

  // N-64: ни заметки, ни облачного номера — что лежит в облаке, неизвестно;
  // это честное «не всё удалено», а не успех.
  it('N-64: returns false when neither the note nor its cloud id is known', async () => {
    expect(await LocalDocumentService.deleteDocument('local_gone', 'user-1', { remove: true })).toBe(false);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('canonical uuid unavailable') }),
      expect.anything(), 'warning');
  });

  // N-65: владелец неизвестен — облачную копию удалить некому, это сбой.
  it('N-65: returns false when the owner of a synced note is missing', async () => {
    docs.set('local_ownerless', { id: 'local_ownerless', uuid: CANON, linkedCloudId: CANON });
    expect(await LocalDocumentService.deleteDocument('local_ownerless', undefined, { remove: true })).toBe(false);
  });

  // R5-031: у незалитой заметки облачного ряда нет, а RLS не пустила бы туда
  // ни одной производной. Удаление без сети не должно говорить «производные
  // остались в облаке» — там ничего не было.
  it('R5-031: never-synced note deleted offline is a full delete, cloud untouched', async () => {
    docs.set('local_new', { id: 'local_new', uuid: CANON, guestId: 'user-1' });
    deleteSummary.mockRejectedValue(new Error('offline'));
    deleteEmbedding.mockRejectedValue(new Error('offline'));
    try {
      expect(await LocalDocumentService.deleteDocument('local_new', 'user-1', { remove: true })).toBe(true);
    } finally {
      deleteSummary.mockResolvedValue(undefined);
      deleteEmbedding.mockResolvedValue(undefined);
    }
    expect(deleteSummary).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  // R5-031: гостевая заметка в облаке не бывает никогда — её удаление полное.
  it('R5-031: guest note deletion is a full delete', async () => {
    docs.set('local_guest_doc', { id: 'local_guest_doc', uuid: CANON, guestId: 'guest_123' });
    expect(await LocalDocumentService.deleteDocument('local_guest_doc', 'guest_123', { remove: true })).toBe(true);
  });

  // R5-031: локальной строки уже нет (сняли параллельно), но облачный номер
  // вызывающий знает — облачные сводка и вектор сносятся по нему, а не
  // остаются навсегда с предупреждением в журнале.
  it('R5-031: note already gone locally — cloud derivatives purged by the passed cloud id', async () => {
    expect(await LocalDocumentService.deleteDocument('local_gone', 'user-1', { remove: true, cloudId: CANON })).toBe(true);
    expect(deleteSummary).toHaveBeenCalledWith('user-1', CANON);
    expect(deleteEmbedding).toHaveBeenCalledWith('user-1', CANON);
    expect(reportError).not.toHaveBeenCalled();
  });

  // R5-031: снять только локальную копию (removeLocalCopy, откат скачивания)
  // — облачная заметка остаётся, и её сводка с вектором тоже.
  it('R5-031: removing only the local copy keeps the cloud summary and embedding', async () => {
    expect(await LocalDocumentService.deleteDocument('local_1')).toBe(true);
    expect(deleteSummary).not.toHaveBeenCalled();
    expect(deleteEmbedding).not.toHaveBeenCalled();
  });

  // Облако остаётся намеренно — значит и «облачные производные остались» не
  // сбой, даже если локальной строки к этому моменту уже нет.
  it('R5-031: removing only the local copy of an already-gone note is not a failure', async () => {
    expect(await LocalDocumentService.deleteDocument('local_gone', 'user-1')).toBe(true);
    expect(reportError).not.toHaveBeenCalled();
  });
});
