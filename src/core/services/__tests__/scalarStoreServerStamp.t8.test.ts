import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance } from '../../storage/localDb';
import { restoreAIDataFromCloud, decideScalarCopy } from '../../../features/ai/services/AIRestoreService';
import { stripCloudStamp } from '../LocalStoreSyncService';

// T-8 (0.10.0, R7Q-004 = R7F-001): спор копий скалярных ИИ-сторов по СЕРВЕРНОЙ
// отметке, а не по часам устройства. Харнесс — как у W-3 (настоящий провайдер,
// подменён только клиент PostgREST).
//
// Исходный комментарий W-3: V-4.2 переключил инкрементальный забор на серверную
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

const UID = 'u_t8_stamp';
const HOUR = 3_600_000;
const SERVER_NOW = Date.UTC(2026, 9, 5, 12, 0, 0);

type Row = {
  user_id: string;
  store: string;
  key: string;
  payload: Record<string, unknown>;
  stamped_at: string;
};

let table: Row[];
let filters: string[];
/** Что происходит на устройстве, пока забор ждёт сеть. */
let duringFetch: (() => void) | undefined;

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
    duringFetch?.();
    duringFetch = undefined;
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


const STAMP_FIELD = '_cloudStampedAt';
/** Устройство A записало портрет сейчас (сервер принял сейчас). */
const fromA = { id: 'singleton', kind: 'portrait', summary: 'Новый с A', updatedAt: SERVER_NOW };
/** Устройство B с часами на два часа вперёд держит прежний портрет, полученный час назад. */
const onB = { id: 'singleton', kind: 'portrait', summary: 'Старый на B', updatedAt: SERVER_NOW + 2 * HOUR, [STAMP_FIELD]: SERVER_NOW - HOUR };

function cloudRows(): Row[] {
  return [{
    user_id: UID, store: 'aiPortrait', key: 'singleton',
    payload: { data: JSON.stringify(fromA), updatedAt: SERVER_NOW },
    stamped_at: iso(SERVER_NOW),
  }];
}

describe('T-8: спор копий скалярного стора — по серверной отметке', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    filters = [];
    duringFetch = undefined;
    table = cloudRows();
    localStorage.clear();
    resetDbInstance();
  });
  afterEach(() => { resetDbInstance(); });

  // Мутация: вернуть прежнее правило «cloudTs > localTs» → красный (часы B «новее»).
  it('часы устройства вперёд больше не держат чужую правку: новее серверная версия — она и приезжает', async () => {
    const db = await getLocalDb(UID);
    await db.put('aiPortrait', onB as never);
    await restoreAIDataFromCloud(UID, {});
    const local = await db.get('aiPortrait', 'singleton') as unknown as Record<string, unknown>;
    expect(local.summary).toBe('Новый с A');
    expect(local[STAMP_FIELD]).toBe(SERVER_NOW);
  });

  it('невыгруженная локальная правка спор не проигрывает', async () => {
    localStorage.setItem('ai_sync_pending_upserts', JSON.stringify([{ uid: UID, store: 'aiPortrait', key: 'singleton' }]));
    const db = await getLocalDb(UID);
    await db.put('aiPortrait', onB as never);
    await restoreAIDataFromCloud(UID, {});
    expect((await db.get('aiPortrait', 'singleton') as unknown as Record<string, unknown>).summary).toBe('Старый на B');
  });

  // Ревью приёмки 0.10.0: журнал читался один раз ДО сетевого запроса. Правка,
  // поставленная в очередь, пока забор ждал сеть, считалась «нет правки» — облако
  // перетирало её, а очередь потом отправляла назад облачное содержимое.
  // Мутация: читать журнал до getLocalStoreRecords → красный.
  it('правка, поставленная в очередь во время забора, тоже не проигрывает', async () => {
    const db = await getLocalDb(UID);
    await db.put('aiPortrait', onB as never);
    duringFetch = () => localStorage.setItem('ai_sync_pending_upserts', JSON.stringify([{ uid: UID, store: 'aiPortrait', key: 'singleton' }]));
    await restoreAIDataFromCloud(UID, {});
    expect((await db.get('aiPortrait', 'singleton') as unknown as Record<string, unknown>).summary).toBe('Старый на B');
  });

  it('журнал невыгруженных правок не читается — «не знаю» не равно «нет»: локальная копия остаётся', async () => {
    localStorage.setItem('ai_sync_pending_upserts', '{битый');
    const db = await getLocalDb(UID);
    await db.put('aiPortrait', onB as never);
    await restoreAIDataFromCloud(UID, {});
    expect((await db.get('aiPortrait', 'singleton') as unknown as Record<string, unknown>).summary).toBe('Старый на B');
  });

  it('облачная версия не новее запомненной — локальная копия остаётся', async () => {
    const db = await getLocalDb(UID);
    await db.put('aiPortrait', { ...onB, [STAMP_FIELD]: SERVER_NOW } as never);
    await restoreAIDataFromCloud(UID, {});
    expect((await db.get('aiPortrait', 'singleton') as unknown as Record<string, unknown>).summary).toBe('Старый на B');
  });

  it('запись до 0.10.0 без отметки с тем же содержимым — отметка запоминается, содержимое не трогается', async () => {
    const db = await getLocalDb(UID);
    await db.put('aiPortrait', fromA as never);
    await restoreAIDataFromCloud(UID, {});
    const local = await db.get('aiPortrait', 'singleton') as unknown as Record<string, unknown>;
    expect(local.summary).toBe('Новый с A');
    expect(local[STAMP_FIELD]).toBe(SERVER_NOW);
  });
});

describe('T-8: правило и служебное поле', () => {
  it('decideScalarCopy', () => {
    const base = { sameContent: false, localTs: 10, cloudTs: 5 };
    expect(decideScalarCopy({ ...base, pending: true, base: 1, cloudStamp: 9 })).toBe('local');
    expect(decideScalarCopy({ ...base, pending: null, base: 1, cloudStamp: 9 })).toBe('local');
    expect(decideScalarCopy({ ...base, pending: false, base: 1, cloudStamp: 9 })).toBe('cloud');
    expect(decideScalarCopy({ ...base, pending: false, base: 9, cloudStamp: 9 })).toBe('local');
    expect(decideScalarCopy({ ...base, pending: false, base: undefined, cloudStamp: 9, sameContent: true })).toBe('adopt');
    // S0-3 (F-2): нет базы, содержимое отличается, невыгруженной правки нет —
    // облако побеждает и запоминается. Прежнее `local` сравнивало часы устройств
    // и держало такую запись в заложниках навсегда (scalarHostageNoBase.s03).
    expect(decideScalarCopy({ ...base, pending: false, base: undefined, cloudStamp: 9 })).toBe('cloud');
    expect(decideScalarCopy({ ...base, pending: false, base: undefined, cloudStamp: undefined, localTs: 1, cloudTs: 2 })).toBe('cloud');
  });

  it('отметка облачной версии в облако не едет', () => {
    expect(stripCloudStamp({ a: 1, [STAMP_FIELD]: 5 })).toEqual({ a: 1 });
    expect(stripCloudStamp({ a: 1 })).toEqual({ a: 1 });
  });
});
