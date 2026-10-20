import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance } from '../../storage/localDb';
import { restoreAIDataFromCloud, decideScalarCopy } from '../../../features/ai/services/AIRestoreService';
import { CLOUD_STAMP_FIELD } from '../LocalStoreSyncService';

// S0-3 (F-2): «заложник» T-8 был не переходным, а вечным.
//
// `decideScalarCopy` при отсутствии локальной базы (`_cloudStampedAt`) и Отличном
// содержимом возвращал `legacy` — сравнение `cloudTs` и `localTs`, где ОБА числа
// придуманы часами устройств. Запись времён 0.9.x с устройства, чьи часы спешат,
// никогда не принимала облачную копию и никогда не запоминала отметку: событие
// «появилась база» зависело только от совпадения содержимого. Итог — чужая
// правка не приезжала никогда, до самой правки часов.
//
// Правило: нет базы, содержимое отличается, НЕвыгруженной локальной правки нет
// (журнал читается и ключа в нём нет) → облако побеждает, и отметка запоминается.
// Обоснование: правку, которую человек не успел выгрузить, видно в очереди;
// запись без очереди и без базы — это копия прошлой синхронизации, и облако для
// неё авторитетно. Невыгруженная правка или нечитаемый журнал — локальная
// остаётся, как и раньше.
//
// Харнесс как у `scalarStoreServerStamp.t8.test.ts`: настоящий провайдер
// `localStore`, подменён только клиент PostgREST.

const UID = 'u_s03_hostage';
const HOUR = 3_600_000;
const SERVER_NOW = Date.UTC(2026, 9, 17, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

type Row = {
  user_id: string;
  store: string;
  key: string;
  payload: Record<string, unknown>;
  stamped_at: string;
};

let table: Row[];
let duringFetch: (() => void) | undefined;

const builder = {
  select() { return this; },
  eq(col: string, val: unknown) {
    table = table.filter(r => (r as unknown as Record<string, unknown>)[col] === val);
    return this;
  },
  gt(col: string, val: unknown) {
    table = table.filter(r => {
      if (col === 'stamped_at') return r.stamped_at > String(val);
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

vi.mock('../../supabase/client', () => ({ getSupabase: () => ({ from: () => builder }) }));

vi.mock('../../data', async () => {
  const actual = await vi.importActual<typeof import('../../data')>('../../data');
  const localStore = await vi.importActual<typeof import('../../data/providers/localStore')>(
    '../../data/providers/localStore',
  );
  return {
    ...actual,
    DataProvider: {
      ...actual.DataProvider,
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
vi.mock('../../crypto/encrypt', () => ({ getSessionKey: () => ({}) }));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

/** Облачная версия, принятая сервером СЕЙЧАС: она реально новее локальной. */
function seedCloud(summary: string) {
  table = [{
    user_id: UID, store: 'aiPortrait', key: 'singleton',
    payload: {
      data: JSON.stringify({ id: 'singleton', summary, updatedAt: SERVER_NOW }),
      updatedAt: SERVER_NOW,
    },
    stamped_at: iso(SERVER_NOW),
  }];
}

async function localPortrait(summary: string, updatedAt: number, extra: Record<string, unknown> = {}) {
  const db = await getLocalDb(UID);
  await db.put('aiPortrait', { id: 'singleton', summary, updatedAt, ...extra } as never);
  return db;
}

async function readPortrait(db: Awaited<ReturnType<typeof getLocalDb>>) {
  return await db.get('aiPortrait', 'singleton') as unknown as Record<string, unknown>;
}

describe('S0-3: запись без базы перестаёт быть вечным заложником', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    duringFetch = undefined;
    table = [];
    localStorage.clear();
    resetDbInstance();
    // SF-5: обёртка `put` переносит `_cloudStampedAt` из прежней строки, а
    // fake-indexeddb переживает resetDbInstance — без очистки «запись без базы»
    // доставала бы отметку из предыдущего прогона.
    await (await getLocalDb(UID)).clear('aiPortrait');
  });

  afterEach(() => { resetDbInstance(); });

  // RT-2, первый тест: часы устройства спешат на два часа, базы нет, содержимое
  // отличается, невыгруженной правки нет.
  // Мутация: вернуть `legacy` (сравнение часов устройств) → красный.
  it('нет базы и нет невыгруженной правки — облачная копия принимается и запоминается', async () => {
    const db = await localPortrait('старое-на-устройстве', SERVER_NOW + 2 * HOUR);
    seedCloud('новое-с-другого-устройства');

    await restoreAIDataFromCloud(UID, {});

    const local = await readPortrait(db);
    expect(local.summary, 'часы вперёд больше не держат чужую правку в заложниках').toBe('новое-с-другого-устройства');
    expect(local[CLOUD_STAMP_FIELD], 'отметка запомнена: следующий спор решается по серверным часам')
      .toBe(SERVER_NOW);
  });

  it('контроль: невыгруженная правка в очереди — локальная остаётся', async () => {
    const db = await localPortrait('локальная-правка', SERVER_NOW + 2 * HOUR);
    seedCloud('новое-с-другого-устройства');
    localStorage.setItem('ai_sync_pending_upserts:' + UID, JSON.stringify([{ uid: UID, store: 'aiPortrait', key: 'singleton' }]));

    await restoreAIDataFromCloud(UID, {});

    const local = await readPortrait(db);
    expect(local.summary).toBe('локальная-правка');
    expect(local[CLOUD_STAMP_FIELD], 'чужую копию поверх невыгруженной не пишем').toBeUndefined();
  });

  it('контроль: журнал не читается — «не знаю» не равно «нет правок»', async () => {
    const db = await localPortrait('локальная-правка', SERVER_NOW + 2 * HOUR);
    seedCloud('новое-с-другого-устройства');
    localStorage.setItem('ai_sync_pending_upserts:' + UID, '{битый');

    await restoreAIDataFromCloud(UID, {});

    expect((await readPortrait(db)).summary).toBe('локальная-правка');
  });

  it('база есть и облако старше неё — локальная копия остаётся (прежнее правило)', async () => {
    const db = await localPortrait('локальная', SERVER_NOW - HOUR, { [CLOUD_STAMP_FIELD]: SERVER_NOW });
    table = [{
      user_id: UID, store: 'aiPortrait', key: 'singleton',
      payload: { data: JSON.stringify({ id: 'singleton', summary: 'облако-из-прошлого' }), updatedAt: SERVER_NOW - 2 * HOUR },
      stamped_at: iso(SERVER_NOW - 2 * HOUR),
    }];

    await restoreAIDataFromCloud(UID, {});

    expect((await readPortrait(db)).summary).toBe('локальная');
  });

  it('правило целиком: без базы и без правки — cloud, с правкой — local', () => {
    const noBase = { base: undefined, sameContent: false, localTs: SERVER_NOW + 2 * HOUR, cloudTs: SERVER_NOW };
    expect(decideScalarCopy({ ...noBase, pending: false, cloudStamp: SERVER_NOW })).toBe('cloud');
    expect(decideScalarCopy({ ...noBase, pending: true, cloudStamp: SERVER_NOW })).toBe('local');
    expect(decideScalarCopy({ ...noBase, pending: null, cloudStamp: SERVER_NOW })).toBe('local');
    expect(decideScalarCopy({ ...noBase, pending: false, cloudStamp: undefined })).toBe('local');
    expect(decideScalarCopy({ ...noBase, pending: false, sameContent: true, cloudStamp: SERVER_NOW })).toBe('adopt');
  });
});
