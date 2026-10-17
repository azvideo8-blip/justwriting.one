import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { LocalStoreSyncManager } from '../../../core/services/LocalStoreSyncService';
import { DataProvider } from '../../../core/data';
import { getLocalDb } from '../../../core/storage/localDb';

const USER = 'u_t8_push_all';

vi.mock('../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../../core/crypto/cryptoHelpers', async (orig) => ({
  ...(await orig<object>()),
  maybeEncrypt: async (x: unknown) => x,
  getEncryptionEnabled: () => false,
}));
vi.mock('../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: USER }),
  getCurrentUserId: () => USER,
}));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

// T-8 (R7F-001): «Отправить всё» с устройства, которое не видело свежую облачную
// версию, перетирало её своей старой копией — с часами вперёд это было ещё и
// незаметно. Теперь запись, чья облачная версия новее той, от которой получена
// локальная копия, проход не выгружает. Мутация: убрать проверку `cloud > base`
// → первый тест красный.
describe('T-8: «Отправить всё» не перетирает облачную версию, которой устройство не видело', () => {
  beforeEach(async () => {
    localStorage.clear();
    const db = await getLocalDb();
    await db.clear('aiPortrait');
    await db.put('aiPortrait' as never, { id: 'p1', portrait: 'старый', updatedAt: 9e12, _cloudStampedAt: 1000 } as never);
    vi.spyOn(DataProvider, 'saveLocalStoreRecord').mockReset().mockResolvedValue(undefined as never);
    if (DataProvider.deleteLocalStorePagedRecords) {
      vi.spyOn(DataProvider, 'deleteLocalStorePagedRecords').mockReset().mockResolvedValue(undefined as never);
    }
  });

  const uploaded = () => vi.mocked(DataProvider.saveLocalStoreRecord).mock.calls.some(c => c[1] === 'aiPortrait' && c[2] === 'p1');

  it('облачная версия новее — запись не выгружается', async () => {
    vi.spyOn(DataProvider, 'getLocalStoreStamps').mockResolvedValue([{ store: 'aiPortrait', key: 'p1', stamped_at: 2000 }]);
    await new LocalStoreSyncManager().syncAllLocalStores(USER);
    expect(uploaded()).toBe(false);
  });

  it('облачная версия не новее — запись выгружается, и без служебной отметки', async () => {
    vi.spyOn(DataProvider, 'getLocalStoreStamps').mockResolvedValue([{ store: 'aiPortrait', key: 'p1', stamped_at: 1000 }]);
    await new LocalStoreSyncManager().syncAllLocalStores(USER);
    expect(uploaded()).toBe(true);
    const payload = vi.mocked(DataProvider.saveLocalStoreRecord).mock.calls.find(c => c[2] === 'p1')?.[3] as { data?: string };
    expect(payload.data).not.toContain('_cloudStampedAt');
  });

  it('отметки не читаются — проход не идёт вовсе («не знаю, что новее»)', async () => {
    vi.spyOn(DataProvider, 'getLocalStoreStamps').mockRejectedValue(new Error('offline'));
    const r = await new LocalStoreSyncManager().syncAllLocalStores(USER);
    expect(r.failed).toBe(1);
    expect(uploaded()).toBe(false);
  });
});
