// NB-14 (sus04): «Отправить всё» — отказ чтения стора IndexedDB попадал в
// catch без result.failed++, и итог выглядел полным успехом, хотя стор
// целиком не выгружен. Харнесс — из pushAllServerStamp.t8.test.ts; мок только
// края (клиент, крипто, auth, чтение ключей IndexedDB), сервис настоящий.
// Мутация: убрать result.failed++ из catch чтения стора — красный а.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { LocalStoreSyncManager } from '../LocalStoreSyncService';
import { DataProvider } from '../../data';
import { getLocalDb } from '../../storage/localDb';

const USER = 'u_sus04_syncall';

vi.mock('../../sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../crypto/cryptoHelpers', async (orig) => ({
  ...(await orig<object>()),
  maybeEncrypt: async (x: unknown) => x,
  getEncryptionEnabled: () => false,
}));
vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: USER }),
  getCurrentUserId: () => USER,
}));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { reportError } from '../../../shared/errors/reportError';

type DbWithKeys = { getAllKeys(store: string): Promise<IDBValidKey[]> };
let db: Awaited<ReturnType<typeof getLocalDb>>;

beforeEach(async () => {
  localStorage.clear();
  db = await getLocalDb(USER);
  await db.clear('aiPortrait');
  vi.spyOn(DataProvider, 'getLocalStoreStamps').mockReset().mockResolvedValue([]);
  vi.spyOn(DataProvider, 'saveLocalStoreRecordIfUnstamped').mockReset().mockResolvedValue({ written: true, stampedAt: null } as never);
  vi.spyOn(DataProvider, 'getLocalStoreRecord').mockReset().mockResolvedValue(null as never);
});

afterEach(() => {
  delete (db as unknown as Partial<DbWithKeys>).getAllKeys;
  vi.restoreAllMocks();
});

describe('NB-14: отказ чтения стора назван в итоге «Отправить всё»', () => {
  it('а) getAllKeys стора отказал — failed считает этот стор', async () => {
    await db.put('aiPortrait' as never, { id: 'p1', portrait: 'синтетика', updatedAt: 1 } as never);
    const orig = (db as unknown as DbWithKeys).getAllKeys.bind(db);
    (db as unknown as DbWithKeys).getAllKeys = (store: string) => {
      if (store === 'aiPortrait') return Promise.reject(new Error('SYNTHETIC_IDB_READ'));
      return orig(store);
    };
    const r = await new LocalStoreSyncManager().syncAllLocalStores(USER);
    expect(r.failed).toBe(1);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'SYNTHETIC_IDB_READ' }),
      expect.objectContaining({ action: 'LocalStoreSyncService_syncAll_store', store: 'aiPortrait' }),
    );
  });

  it('контроль: все сторы читаются — failed 0', async () => {
    const r = await new LocalStoreSyncManager().syncAllLocalStores(USER);
    expect(r.failed).toBe(0);
  });
});