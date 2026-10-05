import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance } from '../../storage/localDb';
import { restoreAIDataFromCloud } from '../../../features/ai/services/AIRestoreService';

// W-3 (ревью 0.9.31): V-4.2 переключил инкрементальный забор на серверную
// отметку stamped_at только когда вызов явно назвал стор aiDialogues. А единственный
// инкрементальный вызывающий (AIRestoreService:227, фоновый проход) передаёт
// store = undefined — значит на проде ветка «по stamped_at» не исполнялась никогда,
// и забор продолжал сравнивать открытый номер в payload. Для строк, которые писало
// устройство с часами на два часа назад, это тот же пропуск, который чинил V-4.2:
// строка не попадает в `> since` ровно два часа.
//
// Тест идёт через restoreAIDataFromCloud и через НАСТОЯЩИЙ провайдер
// localStore (заменён только клиент PostgREST), поэтому правка провайдера и
// правка вызывающего проверяются одним прогоном.

const UID = 'u_w3_pull';
const HOUR = 3_600_000;
const SERVER_NOW = Date.UTC(2026, 9, 5, 12, 0, 0);
/** Часы устройства-писателя отстают на два часа: сервер принял строку СЕЙЧАС, а
 *  внутри лежит отметка двухчасовой давности. */
const DEVICE_STAMP = SERVER_NOW - 2 * HOUR;
const CURSOR = SERVER_NOW - HOUR;

type Row = {
  user_id: string;
  store: string;
  key: string;
  payload: Record<string, unknown>;
  stamped_at: string;
};

let table: Row[];
let filters: string[];

const iso = (ms: number) => new Date(ms).toISOString();

const builder = {
  select() { return this; },
  eq(col: string, val: unknown) {
    filters.push(`eq:${col}`);
    table = table.filter(r => (r as unknown as Record<string, unknown>)[col] === val);
    return this;
  },
  gt(col: string, val: unknown) {
    filters.push(`gt:${col}=${String(val)}`);
    table = table.filter(r => {
      if (col === 'stamped_at') return r.stamped_at > String(val);
      if (col === 'payload->>updatedAt') return String((r.payload.updatedAt as number | undefined) ?? '') > String(val);
      throw new Error(`неизвестный фильтр ${col}`);
    });
    return this;
  },
  order() { return this; },
  range(from: number, to: number) {
    const rows = table.slice(from, to + 1);
    table = [];
    return Promise.resolve({ data: rows, error: null });
  },
};

vi.mock('../../supabase/client', () => ({
  getSupabase: () => ({ from: () => builder }),
}));

vi.mock('../../data', async () => {
  const actual = await vi.importActual<typeof import('../../data')>('../../data');
  const localStore = await vi.importActual<typeof import('../../data/providers/localStore')>(
    '../../data/providers/localStore',
  );
  return {
    ...actual,
    DataProvider: {
      // Настоящий провайдер — он и есть предмет проверки.
      getLocalStoreRecords: (uid: string, store?: string, sinceMs?: number) =>
        localStore.getLocalStoreRecords(uid, store, sinceMs),
      getUserSummaries: async () => [],
      getSummariesLastSync: async () => null,
      getLocalStoreRecord: async () => null,
      getLocalStoreRecordPages: async () => [],
      getLocalStoreRecordsByKeyPrefix: async () => [],
      deleteLocalStoreRecordsByKeys: async () => {},
    },
  };
});

vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: UID, email: 'u@example.com' }),
  getCurrentUserId: () => UID,
}));
vi.mock('../../sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeDecrypt: async (doc: Record<string, unknown>) => doc,
  maybeEncrypt: async (doc: Record<string, unknown>) => doc,
}));
vi.mock('../../crypto/encrypt', () => ({ getSessionKey: () => null }));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const portrait = { id: 'singleton', kind: 'portrait', summary: 'Портрет', updatedAt: DEVICE_STAMP };

function rows(): Row[] {
  return [
    {
      user_id: UID,
      store: 'aiPortrait',
      key: 'singleton',
      payload: { data: JSON.stringify(portrait), updatedAt: DEVICE_STAMP },
      stamped_at: iso(SERVER_NOW),
    },
    {
      // Строка, которую сервер не трогал с тех пор, как курсор ушёл вперёд: она
      // обязана остаться за выборкой, иначе «фильтр по stamped_at» означал бы
      // «присылать всё».
      user_id: UID,
      store: 'aiChatMemory',
      key: 'old',
      payload: { data: JSON.stringify({ id: 'old', note: 'старое', updatedAt: DEVICE_STAMP }), updatedAt: DEVICE_STAMP },
      stamped_at: iso(SERVER_NOW - 2 * HOUR - 1000),
    },
  ];
}

describe('W-3: инкрементальный забор всех сторов по серверной отметке', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    filters = [];
    table = rows();
    localStorage.clear();
    resetDbInstance();
  });

  afterEach(() => {
    resetDbInstance();
  });

  it('запись стора, написанного отстающими часами, приезжает в этот проход', async () => {
    const db = await getLocalDb(UID);
    expect(await db.get('aiPortrait', 'singleton')).toBeUndefined();

    const result = await restoreAIDataFromCloud(UID, { sinceMs: CURSOR });

    expect(filters).toContain(`gt:stamped_at=${iso(CURSOR)}`);
    expect(result.localStoreRecords, 'без правки строка отфильтрована по payload.updatedAt').toBe(1);
    const local = await db.get('aiPortrait', 'singleton') as { summary?: string } | undefined;
    expect(local?.summary).toBe('Портрет');
  });

  it('отрицательный контроль: строка старше курсора в этот проход не приезжает', async () => {
    const db = await getLocalDb(UID);

    await restoreAIDataFromCloud(UID, { sinceMs: CURSOR });

    expect(await db.get('aiChatMemory', 'old')).toBeUndefined();
  });
});
