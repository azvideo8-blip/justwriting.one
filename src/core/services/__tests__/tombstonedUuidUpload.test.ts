import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

/**
 * LIFE-10 — номер заметки держит НАДГРОБИЕ.
 *
 * Ограничение `documents_uuid_key` считает удалённые строки, а поиск заметки —
 * нет (`deleted_at is null`). Поэтому выгрузка падала с «duplicate key value
 * violates unique constraint», восстановление по номеру не находило ничего и
 * пробрасывало ошибку дальше. Заметка оставалась в одном браузере навсегда, а
 * очередь бесконечно повторяла заведомо безнадёжную задачу. Так в августе
 * заперло четырнадцать заметок «Практика».
 *
 * Чинить это «оживлением» строки нельзя: политика 0016 делает надгробие
 * неизменяемым намеренно — иначе клиент отменял бы удаление, сделанное на
 * другом устройстве. Поэтому правило такое:
 *
 * 1) устройство узнаёт об удалении впервые — оно его ЗАПИСЫВАЕТ и говорит
 *    человеку, а не обходит;
 * 2) человек, прочитав это и нажав ещё раз, получает новую облачную копию под
 *    новым номером — уже как осознанное решение, вслух названное в журнале.
 */

const createDocument = vi.fn();
const findByUuid = vi.fn();
const getDocumentWithDeleted = vi.fn();
const addActivity = vi.fn();

vi.mock('../DocumentService', () => ({
  DocumentService: {
    createDocument: (...a: unknown[]) => createDocument(...a),
    findByUuid: (...a: unknown[]) => findByUuid(...a),
    getDocumentWithDeleted: (...a: unknown[]) => getDocumentWithDeleted(...a),
    getDocument: vi.fn(),
    getUserDocuments: vi.fn(async () => []),
    updateDocumentAfterSession: vi.fn(async () => undefined),
  },
}));
vi.mock('../VersionService', () => ({
  VersionService: { getVersions: vi.fn(async () => []), addVersion: vi.fn(async () => undefined) },
}));
vi.mock('../../../shared/activity/useActivityLogStore', () => ({
  useActivityLogStore: { getState: () => ({ addActivity }) },
}));

const { CloudSyncService, CLOUD_COPY_TOMBSTONE } = await import('../CloudSyncService');
const { getLocalDb } = await import('../../storage/localDb');

const USER = 'user_life10';
const BURIED = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const DUPLICATE = Object.assign(new Error('duplicate key value violates unique constraint "documents_uuid_key"'), { code: '23505' });

async function seed(over: Record<string, unknown> = {}) {
  const db = await getLocalDb(USER);
  for (const r of await db.getAll('documents')) await db.delete('documents', (r as { id: string }).id);
  for (const r of await db.getAll('syncQueue')) await db.delete('syncQueue', (r as { id: string }).id);
  await db.put('documents', {
    id: 'local_1', guestId: USER, uuid: BURIED, title: 'Практика — день 7',
    currentVersion: 1, totalWords: 1526, totalDuration: 0, sessionsCount: 1,
    firstSessionAt: 1, lastSessionAt: 1, tags: [], linkedCloudId: '',
    ...over,
  } as never);
  await db.put('syncQueue', { id: 'sync_local_1', documentId: 'local_1', createdAt: Date.now() } as never);
}

describe('LIFE-10: номер занят надгробием', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createDocument.mockRejectedValue(DUPLICATE);
    findByUuid.mockResolvedValue(null);
    getDocumentWithDeleted.mockResolvedValue({ id: BURIED, uuid: BURIED, deletedAt: new Date() });
  });

  it('первое нажатие: удаление записано, ошибка наружу не идёт, очередь очищена', async () => {
    await seed();

    const cloudId = await CloudSyncService.addCloudCopy(USER, 'local_1');

    expect(cloudId, 'выгрузки не было — и говорить, что была, нельзя').toBe(CLOUD_COPY_TOMBSTONE);

    const db = await getLocalDb(USER);
    const doc = await db.get('documents', 'local_1');
    expect(doc!.unlinkedByTombstone, 'удаление записано как факт').toBe(true);
    expect(doc!.localOnly, 'автопроход не должен подхватывать эту заметку').toBe(true);
    expect(await db.get('syncQueue', 'sync_local_1'), 'безнадёжная задача снята').toBeUndefined();

    expect(createDocument, 'нового номера на первом нажатии не выдаётся').toHaveBeenCalledTimes(1);
    expect(addActivity.mock.calls[0]?.[0]).toBe('activity_cloud_tombstone');
  });

  it('текст заметки остаётся на устройстве целиком', async () => {
    await seed();

    await CloudSyncService.addCloudCopy(USER, 'local_1');

    const db = await getLocalDb(USER);
    const doc = await db.get('documents', 'local_1');
    expect(doc!.title).toBe('Практика — день 7');
    expect(doc!.totalWords).toBe(1526);
  });

  it('второе нажатие: новая облачная копия под новым номером, названная вслух', async () => {
    await seed({ localOnly: true, unlinkedByTombstone: true });
    createDocument
      .mockRejectedValueOnce(DUPLICATE)
      .mockResolvedValueOnce('cloud_new');

    const cloudId = await CloudSyncService.addCloudCopy(USER, 'local_1');

    expect(cloudId).toBe('cloud_new');

    const db = await getLocalDb(USER);
    const doc = await db.get('documents', 'local_1');
    expect(doc!.uuid, 'номер сменился').not.toBe(BURIED);
    expect(doc!.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(doc!.linkedCloudId).toBe('cloud_new');
    expect(doc!.localOnly, 'связь есть — пометка «только на устройстве» снята').toBeUndefined();

    const second = createDocument.mock.calls[1]?.[0 + 1] as { uuid?: string } | undefined;
    expect(second?.uuid, 'вторая попытка идёт с новым номером').toBe(doc!.uuid);
    expect(addActivity.mock.calls.some(c => c[0] === 'activity_cloud_new_identity')).toBe(true);
  });

  /**
   * Соседний случай, который легко перепутать: ограничение сработало, но
   * строки нет вообще ни живой, ни удалённой. Причина неизвестна — значит
   * ошибка обязана выйти наружу, а не быть проглоченной как «надгробие».
   */
  it('строки нет ни живой, ни удалённой → ошибка идёт наружу', async () => {
    await seed();
    getDocumentWithDeleted.mockResolvedValue(null);

    await expect(CloudSyncService.addCloudCopy(USER, 'local_1')).rejects.toThrow(/duplicate key/i);
  });

  it('живая строка с этим номером — по-прежнему просто перепривязка', async () => {
    await seed();
    findByUuid.mockResolvedValue({ id: BURIED, uuid: BURIED });

    const cloudId = await CloudSyncService.addCloudCopy(USER, 'local_1');

    expect(cloudId).toBe(BURIED);
    expect(getDocumentWithDeleted, 'до могилы дело не дошло').not.toHaveBeenCalled();
  });
});
