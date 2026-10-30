import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance } from '../../storage/localDb';
import { restoreAIDataFromCloud } from '../../../features/ai/services/AIRestoreService';
import { LocalStoreSyncService, cloudFormOf } from '../LocalStoreSyncService';

// DY10-8 (владелец 30.10: «векторы не синхронизируй»): вектор-кэш «обязательств»
// и «журнала тем» в облако не едет (~65 из 71 МБ). Загрузка из облака не стирает
// локальный вектор; толстая облачная копия (до DY10-8) уходит назад облегчённой.
// Мутации: cloudFormOf без снятия вектора → (1) красный; запись облака без
// keepLocalVector → (2) красный; без scheduleStoreSync толстой копии → (3) красный.
// Харнесс — как у T-8 (настоящий провайдер, подменён только клиент PostgREST).

const UID = 'u_dy108_vec';
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



const VEC = [0.1, 0.2, 0.3];
const commitment = (extra: Record<string, unknown>) => ({ id: 'c1', text: 'Позвонить маме в субботу', documentId: 'd1', createdAt: 1, date: '2026-10-29', status: 'open', ...extra });

function cloudRow(record: Record<string, unknown>, stampMs = SERVER_NOW): Row {
  return {
    user_id: UID, store: 'aiCommitments', key: 'c1',
    payload: { data: JSON.stringify(record), updatedAt: stampMs },
    stamped_at: iso(stampMs),
  };
}

describe('DY10-8: вектор-кэш не синхронизируется', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    filters = [];
    duringFetch = undefined;
    localStorage.clear();
    resetDbInstance();
  });
  afterEach(() => { resetDbInstance(); vi.restoreAllMocks(); });

  it('(1) облачный вид записи — без вектора у обязательства и с пустым у темы', () => {
    expect(cloudFormOf('aiCommitments', commitment({ vector: VEC }))).not.toHaveProperty('vector');
    expect((cloudFormOf('aiThemeLedger', { id: 't1', theme: 'усталость', themeVector: VEC }) as { themeVector: unknown }).themeVector).toEqual([]);
    expect(cloudFormOf('aiPortrait', { id: 'singleton', vector: VEC })).toHaveProperty('vector');
  });

  it('(2) облачная правка без вектора не стирает локальный вектор той же записи', async () => {
    const db = await getLocalDb(UID);
    await db.put('aiCommitments', { ...commitment({ vector: VEC }), _cloudStampedAt: SERVER_NOW - HOUR } as never);
    table = [cloudRow(commitment({ status: 'done' }))];
    await restoreAIDataFromCloud(UID, {});
    const local = await db.get('aiCommitments', 'c1') as unknown as Record<string, unknown>;
    expect(local.status).toBe('done');
    expect(local.vector).toEqual(VEC);
  });

  it('(3) толстая облачная копия (с вектором) уходит назад облегчённой', async () => {
    const spy = vi.spyOn(LocalStoreSyncService, 'scheduleStoreSync').mockImplementation(() => {});
    table = [cloudRow(commitment({ vector: VEC }))];
    await restoreAIDataFromCloud(UID, {});
    expect(spy).toHaveBeenCalledWith('aiCommitments', 'c1');
  });
});
