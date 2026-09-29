import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  LocalStoreSyncManager,
  getPendingStoreDeleteKeys,
  getLocalStoreSyncSummary,
} from '../LocalStoreSyncService';
import { DataProvider } from '../../data';
import { getLocalDb } from '../../storage/localDb';
import { reportError } from '../../../shared/errors/reportError';

const USER = 'u_a5_journal';
const DELETES_KEY = 'ai_sync_pending_deletes';
// Строка, написанная другой версией приложения: readPersistedDeletes не может её
// разобрать и обязан вернуть «неизвестно», а не пустой список.
const CORRUPT = '{обрывок без закрывающей скобки';

vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
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

// A-5 (R2-012): нечитаемый журнал незакрытых облачных удалений раньше читался
// как «удалений нет». Дренаж ставил в очередь upsert живой записи, а рядом лежал
// маркер на то, что эту запись пользователь снёс, — и следующий проход возвращал
// в облако удалённый разбор.
describe('A-5 (R2-012): an unreadable delete journal is unknown, not empty', () => {
  beforeEach(async () => {
    localStorage.clear();
    const db = await getLocalDb();
    await db.clear('aiPortrait');
    await db.put('aiPortrait' as never, { id: 'p1', portrait: '# разбор', updatedAt: 1000, generatedAtDelta: 0 } as never);
    vi.spyOn(DataProvider, 'saveLocalStoreRecord').mockReset().mockResolvedValue(undefined as never);
    if (DataProvider.deleteLocalStorePagedRecords) {
      vi.spyOn(DataProvider, 'deleteLocalStorePagedRecords').mockReset().mockResolvedValue(undefined as never);
    }
    vi.spyOn(DataProvider, 'deleteLocalStoreRecord').mockReset().mockResolvedValue(undefined as never);
    vi.mocked(reportError).mockClear();
  });

  it('names the journal unreadable instead of reporting no pending deletions', () => {
    localStorage.setItem(DELETES_KEY, CORRUPT);
    expect(getPendingStoreDeleteKeys(USER)).toBeNull();
    expect(getLocalStoreSyncSummary(USER)).toEqual({ pending: 0, dead: 0, unknown: true });
  });

  it('sends no upsert while the journal is unreadable, and keeps the obligation', async () => {
    localStorage.setItem(DELETES_KEY, CORRUPT);

    const tab = new LocalStoreSyncManager();
    tab.scheduleStoreSync('aiPortrait', 'p1');
    // Проверка «запись ещё жива» в scheduleStoreSync — fire-and-forget, ждём её.
    await new Promise(r => setTimeout(r, 50));

    await tab.flushPending(true);

    expect(DataProvider.saveLocalStoreRecord, 'upsert воскресит в облаке удалённую запись')
      .not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'flushPending_deleteJournalUnknown', userId: USER }),
      'warning',
    );
    // Отложено, а не исполнено: бейдж по-прежнему видит несданное.
    expect(getLocalStoreSyncSummary(USER)).toEqual({ pending: 1, dead: 0, unknown: true });
  });

  it('still runs deletions, and a finished one does not overwrite the unreadable journal', async () => {
    localStorage.setItem(DELETES_KEY, CORRUPT);

    const tab = new LocalStoreSyncManager();
    tab.scheduleStoreDelete('aiPortrait', 'p2');
    await tab.flushPending(true);

    expect(DataProvider.deleteLocalStoreRecord).toHaveBeenCalledWith(USER, 'aiPortrait', 'p2');
    expect(localStorage.getItem(DELETES_KEY)).toBe(CORRUPT);
  });
});
