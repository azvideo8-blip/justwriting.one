import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

/**
 * Перепривязка заметки к её облачной строке по ПОСТОЯННОМУ номеру.
 *
 * Случай из жизни: 14 заметок («Практика, день 3–16», по полторы тысячи слов)
 * потеряли связь с облаком в августе. Вернуть их было нельзя ничем:
 *
 * - выгрузка как новых падала с `duplicate key value violates unique
 *   constraint "documents_uuid_key"` — облачная строка с этим номером уже
 *   существовала;
 * - перепривязка сверяла только время первой сессии, а у осиротевшей строки
 *   оно было записью о её создании, а не о дате заметки, — совпадения нет;
 * - отвязка вручную ставила «только на устройстве», и заметка выпадала из
 *   всех проходов совсем.
 *
 * Совпадение uuid — не догадка, а тождество. Оно и решает.
 */

const updateLinkedCloudId = vi.fn(async () => undefined);

vi.mock('../LocalStorageService', () => ({
  LocalStorageService: { updateLinkedCloudId },
}));
vi.mock('../../../shared/activity/useActivityLogStore', () => ({
  useActivityLogStore: { getState: () => ({ addActivity: vi.fn() }) },
}));

const { __testing } = await import('../CloudSyncService');
const { getLocalDb } = await import('../../storage/localDb');

const UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function local(over: Record<string, unknown> = {}) {
  return {
    id: 'local_1', uuid: UUID, guestId: 'u1', title: 'Практика — день 7',
    currentVersion: 1, totalWords: 1526, totalDuration: 0, sessionsCount: 1,
    firstSessionAt: 1_700_000_000_000, lastSessionAt: 1_700_000_000_000, tags: [],
    ...over,
  } as never;
}

function cloud(over: Record<string, unknown> = {}) {
  return {
    id: 'cloud_1', uuid: UUID, title: '',
    // Время у осиротевшей строки — момент её создания, а не дата заметки.
    firstSessionAt: new Date('2026-08-25T12:45:00Z'),
    lastSessionAt: new Date('2026-08-25T12:45:00Z'),
    currentVersion: 0, totalWords: 0,
    ...over,
  } as never;
}

describe('перепривязка по постоянному номеру', () => {
  beforeEach(() => vi.clearAllMocks());

  it('связывает заметку с её строкой, когда время не совпадает', async () => {
    const docs = [local()];

    const n = await __testing.relinkOrphaned(docs, [cloud()]);

    expect(n).toBe(1);
    expect(updateLinkedCloudId).toHaveBeenCalledWith('local_1', 'cloud_1');
  });

  /**
   * Вернуть связь мало. Облачная строка осталась пустой, а связанная заметка
   * ни одним проходом не выгружается — её надо поставить в очередь, иначе
   * текст так и не уедет и «связана» будет означать «по-прежнему только здесь».
   */
  it('ставит перепривязанную заметку в очередь на выгрузку', async () => {
    const docs = [local()];

    await __testing.relinkOrphaned(docs, [cloud()]);

    const db = await getLocalDb();
    const task = await db.get('syncQueue', 'sync_local_1');
    expect(task?.documentId).toBe('local_1');
  });

  /**
   * Отвязанную вручную заметку сверка по времени не трогает намеренно. Но
   * совпадение номера означает, что облачная копия — эта же заметка, а не
   * воскрешаемая: удалённые строки сюда не приходят вовсе.
   */
  it('возвращает и заметку, помеченную «только на устройстве»', async () => {
    const docs = [local({ localOnly: true })];

    const n = await __testing.relinkOrphaned(docs, [cloud()]);

    expect(n).toBe(1);
    expect((docs[0] as unknown as { localOnly?: boolean }).localOnly).toBeUndefined();
  });

  it('не трогает заметку, у которой связь на месте', async () => {
    const docs = [local({ linkedCloudId: 'cloud_1' })];

    const n = await __testing.relinkOrphaned(docs, [cloud()]);

    expect(n).toBe(0);
    expect(updateLinkedCloudId).not.toHaveBeenCalled();
  });

  it('не выбирает наугад, когда номер встречается дважды', async () => {
    const docs = [local()];

    const n = await __testing.relinkOrphaned(docs, [cloud(), cloud({ id: 'cloud_2' })]);

    expect(n).toBe(0);
    expect(updateLinkedCloudId).not.toHaveBeenCalled();
  });

  it('чужая облачная строка не подбирается по номеру', async () => {
    const docs = [local()];

    const n = await __testing.relinkOrphaned(docs, [cloud({ uuid: 'другой-номер' })]);

    expect(n).toBe(0);
  });
});
