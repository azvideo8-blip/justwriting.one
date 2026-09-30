import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  LocalStoreSyncManager,
  getLocalStoreSyncSummary,
  getDeadStoreUpserts,
} from '../LocalStoreSyncService';
import { DataProvider } from '../../data';
import { getLocalDb } from '../../storage/localDb';

const USER = 'u_sa1_durability';

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

/** SA-1: очередь ИИ-сторов пережила перезагрузку или нет — проверяем новым
 *  экземпляром менеджера: старый вместе с его Map живёт ровно до закрытия
 *  вкладки. */
describe('SA-1: pending AI-store upserts survive the tab closing', () => {
  let save: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    localStorage.clear();
    const db = await getLocalDb();
    await db.put('aiPortrait' as never, { id: 'p1', portrait: '# x', updatedAt: 1000, generatedAtDelta: 0 } as never);
    if (DataProvider.deleteLocalStorePagedRecords) vi.spyOn(DataProvider, 'deleteLocalStorePagedRecords').mockReset().mockResolvedValue(undefined as never);
    save = vi.spyOn(DataProvider, 'saveLocalStoreRecord').mockReset().mockResolvedValue(undefined as never);
  });

  it('a scheduled upsert is handed to the next instance, not lost with the old one', async () => {
    const closedTab = new LocalStoreSyncManager();
    closedTab.scheduleStoreSync('aiPortrait', 'p1');
    // Вкладка закрылась в окне дебаунса: ни одного flush не было.
    expect(getLocalStoreSyncSummary(USER)).toEqual({ pending: 1, dead: 0, oversized: 0, unknown: false });

    const reopened = new LocalStoreSyncManager();
    const res = await reopened.flushPending(true);

    expect(res.synced).toBe(1);
    expect(save).toHaveBeenCalledWith(USER, 'aiPortrait', 'p1', expect.anything());
    expect(getLocalStoreSyncSummary(USER)).toEqual({ pending: 0, dead: 0, oversized: 0, unknown: false });
  });

  it('counts attempts across instances, so a permanently rejected record still ends up dead', async () => {
    save.mockRejectedValue(new Error('Failed to fetch'));

    const first = new LocalStoreSyncManager();
    first.scheduleStoreSync('aiPortrait', 'p1');
    await first.flushPending(true);
    await first.flushPending(true);

    const second = new LocalStoreSyncManager();
    for (let i = 0; i < 4; i++) await second.flushPending(true);

    expect(save).toHaveBeenCalledTimes(5);
    const dead = getDeadStoreUpserts(USER);
    expect(dead.map(d => `${d.store}/${d.key}`)).toEqual(['aiPortrait/p1']);
    expect(dead[0]?.lastError).toContain('Failed to fetch');
    // Мёртвая запись больше не «в очереди»: она в отдельной, видимой отметке.
    expect(getLocalStoreSyncSummary(USER)).toEqual({ pending: 0, dead: 1, oversized: 0, unknown: false });
  });

  it('a rejected record stays visible as dead after a reload, not silently dropped', async () => {
    save.mockRejectedValue(new Error('413 too large'));
    const tab = new LocalStoreSyncManager();
    tab.scheduleStoreSync('aiPortrait', 'p1');
    for (let i = 0; i < 8; i++) await tab.flushPending(true);

    expect(save).toHaveBeenCalledTimes(5);
    expect(getLocalStoreSyncSummary(USER).dead).toBe(1);

    // Перезагрузка: отметка лежит на диске, бейдж видит её сразу.
    const afterReload = new LocalStoreSyncManager();
    await afterReload.flushPending(true);
    expect(save).toHaveBeenCalledTimes(5);
    expect(getLocalStoreSyncSummary(USER)).toEqual({ pending: 0, dead: 1, oversized: 0, unknown: false });
  });

  it('a new local change revives a rejected record and clears its mark', async () => {
    save.mockRejectedValue(new Error('Failed to fetch'));
    const tab = new LocalStoreSyncManager();
    tab.scheduleStoreSync('aiPortrait', 'p1');
    for (let i = 0; i < 6; i++) await tab.flushPending(true);
    expect(getLocalStoreSyncSummary(USER)).toEqual({ pending: 0, dead: 1, oversized: 0, unknown: false });

    save.mockResolvedValue(undefined as never);
    tab.scheduleStoreSync('aiPortrait', 'p1');
    expect(getLocalStoreSyncSummary(USER)).toEqual({ pending: 1, dead: 0, oversized: 0, unknown: false });
    await tab.flushPending(true);
    expect(getLocalStoreSyncSummary(USER)).toEqual({ pending: 0, dead: 0, oversized: 0, unknown: false });
  });
});
