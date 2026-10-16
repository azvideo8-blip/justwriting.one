import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance } from '../../storage/localDb';
import { LocalStoreSyncService } from '../LocalStoreSyncService';

// R7Q-006: flushPending снимает debounce-будильник на входе и в нескольких местах
// выходит, ничего не сделав: нет пользователя, выключена облачная синхронизация,
// сейф заперт, и идущий параллельно проход. Прежним кодом после такого выхода
// очередь оставалась непустой, а будильника — уже нет: правки ждали, пока человек
// снова что-нибудь наберёт. Хуже всего запертый сейф: человек разблокировался, а
// разборы и диалоги, записанные до блокировки, всё ещё лежат в очереди.

const UID = 'u_r7q006';
const STORE = 'aiCommitments';
const KEY = 'c-1';
const KEY2 = 'c-2';

const cloud = new Map<string, { store: string; key: string; payload: Record<string, unknown> }>();
const saved: string[] = [];
let encryptionEnabled = true;
let hasSessionKey = false;
let cloudOn = true;
/** Подвешивает первый облачный вызов, чтобы поймать параллельный проход. */
let hangNextSave = false;
let releaseSave: (() => void) | null = null;

vi.mock('../../data', () => ({
  DataProvider: {
    getLocalStoreRecords: async () => [],
    getLocalStoreRecord: async (_uid: string, store: string, key: string) => {
      const r = cloud.get(`${store}:${key}`);
      return r ? { store, key, payload: r.payload } : null;
    },
    saveLocalStoreRecord: async (_uid: string, store: string, key: string, payload: Record<string, unknown>) => {
      if (hangNextSave) {
        hangNextSave = false;
        await new Promise<void>(res => { releaseSave = res; });
      }
      saved.push(`${store}:${key}`);
      cloud.set(`${store}:${key}`, { store, key, payload });
    },
    deleteLocalStoreRecordsByKeys: async () => {},
    getUserSummaries: async () => [],
    getUserEmbeddingsPaginated: async () => ({ items: [], nextCursorId: null, readCount: 0 }),
  },
}));
vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: UID, email: 'someone@example.com' }),
  getCurrentUserId: () => UID,
}));
vi.mock('../../sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => cloudOn }));
vi.mock('../../crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => encryptionEnabled,
  maybeDecrypt: async (doc: Record<string, unknown>) => doc,
  maybeEncrypt: async (doc: Record<string, unknown>) => doc,
}));
vi.mock('../../crypto/encrypt', () => ({
  getSessionKey: () => (hasSessionKey ? ({ toString: () => 'k' } as never) : null),
}));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../shared/errors/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

/** Прогонить микротasks и setImmediate: IDB и провайдер живут на них, а не на
 *  подставных таймерах, иначе проверка успевает раньше записи. */
async function pump(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await new Promise(res => setImmediate(res));
}

async function putRecord(id: string): Promise<void> {
  const db = await getLocalDb();
  await db.put(STORE, {
    id,
    text: `Дело ${id}`,
    documentId: 'doc-1',
    date: '2026-10-01',
    status: 'open',
    createdAt: 1000,
  });
}

async function stagePending(id = KEY): Promise<void> {
  await putRecord(id);
  LocalStoreSyncService.scheduleStoreSync(STORE, id);
}

describe('R7Q-006: ранний выход из flushPending не оставляет очередь без повтора', () => {
  beforeEach(async () => {
    // IDB (fake-indexeddb) живёт на setImmediate — его не трогаем, иначе висит
    // любое ожидание записи. Будильники сервиса под нашим контролем.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    cloudOn = true;
    hangNextSave = false;
    releaseSave = null;
    cloud.clear();
    saved.length = 0;
    localStorage.clear();
    // Очередь сервиса — синглтон на файл: без дренажа остаток прошлого теста
    // уехал бы в облако под номером следующего.
    encryptionEnabled = false;
    hasSessionKey = true;
    await LocalStoreSyncService.flushPending(true);
    encryptionEnabled = true;
    hasSessionKey = false;
    cloud.clear();
    saved.length = 0;
    resetDbInstance();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetDbInstance();
  });

  it('сейф отперли — очередь уходит в облако сама, без новой правки', async () => {
    await stagePending();
    await vi.advanceTimersByTimeAsync(1500);
    await pump();
    expect(saved, 'при запертом сейфе ничего не отправляется').toEqual([]);
    expect(vi.getTimerCount(), 'выход «сейф заперт» обязан оставить будильник').toBe(1);

    hasSessionKey = true;
    // Повтор намечен, но не каждые 1,5 с: запертый сейф может продержаться весь
    // вечер, и дебаунсный опрос будил бы приложение без конца (пауза — 30 с).
    await vi.advanceTimersByTimeAsync(1500);
    await pump();
    expect(saved, 'раньше retry-паузы повтора нет').toEqual([]);

    await vi.advanceTimersByTimeAsync(30_000);
    await pump();
    expect(saved, `после разблокировки отправлено: ${saved.join(' ')}`).toContain(`${STORE}:${KEY}`);
  });

  it('параллельный проход: правка, помеченная во время sync, дожидается очереди', async () => {
    hasSessionKey = true;
    hangNextSave = true;
    await stagePending();

    const first = LocalStoreSyncService.flushPending();
    await new Promise(res => setImmediate(res));
    expect(releaseSave, 'первый проход дошёл до облака и висит в нём').toBeTruthy();

    await putRecord(KEY2);
    LocalStoreSyncService.scheduleStoreSync(STORE, KEY2);
    await vi.advanceTimersByTimeAsync(1500);
    await pump();
    expect(saved, 'пока первый проход висит, второго в облаке нет').not.toContain(`${STORE}:${KEY2}`);
    expect(vi.getTimerCount(), 'выход по isSyncing обязан оставить будильник').toBe(1);

    releaseSave?.();
    await first;
    await vi.advanceTimersByTimeAsync(30_000);
    await pump();
    expect(saved, `второй проход: ${saved.join(' ')}`).toContain(`${STORE}:${KEY2}`);
  });

  it('выключенная синхронизация и пустая очередь не будят прогон вслепую', async () => {
    // Тумблер при включении сам дёргает синхронизацию (CLOUD_SYNC_CHANGED), а
    // вход — полный забор. Крутить таймер, пока облака нет, незачем.
    cloudOn = false;
    hasSessionKey = true;
    await stagePending();
    await vi.advanceTimersByTimeAsync(1500);
    await pump();
    expect(vi.getTimerCount(), 'при выключенной синхронизации будильника нет').toBe(0);
    await vi.advanceTimersByTimeAsync(120_000);
    await pump();
    expect(saved, 'и отправок тоже нет').toEqual([]);
  });

  it('пустая очередь не заводит таймер', async () => {
    hasSessionKey = true;
    cloudOn = true;
    // Абсолютный счётчик тут не годится: fake-indexeddb сам держит пару
    // таймеров. Значит сравниваем с собой: проход по пустой очереди не должен
    // добавить ни одного будильника.
    const timersBefore = vi.getTimerCount();
    const res = await LocalStoreSyncService.flushPending();
    await pump();
    expect(res.synced).toBe(0);
    expect(vi.getTimerCount(), 'нечего отправлять — нечего и будить').toBe(timersBefore);
  });
});
