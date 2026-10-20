import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  LocalStoreSyncManager,
  getPendingStoreDeleteKeys,
  getLocalStoreSyncSummary,
} from '../../../core/services/LocalStoreSyncService';
import { DataProvider } from '../../../core/data';
import { getLocalDb } from '../../../core/storage/localDb';

const USER = 'u_a1_delete_marker';

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

// A-1 (R2-003): запись удалена → облачное удаление упало (офлайн) → маркер
// лёг на диск → запись вернулась (восстановление из корзины, правка с другого
// устройства, пересоздание ИИ-проходом). scheduleStoreSync обязан снять
// обязательство «снести в облаке» в тот же шаг, что ставит «доехать как
// обновление»: иначе следующий дренаж перечитает маркер и удалит в облаке ряд
// живой записи.
describe('A-1 (R2-003): a record that exists again drops its persisted delete marker', () => {
  beforeEach(async () => {
    localStorage.clear();
    const db = await getLocalDb();
    await db.clear('aiPortrait');
    await db.put('aiPortrait' as never, { id: 'p1', portrait: '# восстановленный разбор', updatedAt: 1000, generatedAtDelta: 0 } as never);
    vi.spyOn(DataProvider, 'saveLocalStoreRecordIfUnstamped').mockReset().mockResolvedValue({ written: true, stampedAt: null } as never);
    vi.spyOn(DataProvider, 'getLocalStoreRecord').mockReset().mockResolvedValue(null as never);
    // T-8: «Отправить всё» читает серверные отметки — облака здесь нет.
    vi.spyOn(DataProvider, 'getLocalStoreStamps').mockResolvedValue([]);
    if (DataProvider.deleteLocalStorePagedRecords) {
      vi.spyOn(DataProvider, 'deleteLocalStorePagedRecords').mockReset().mockResolvedValue(undefined as never);
    }
    vi.spyOn(DataProvider, 'deleteLocalStoreRecord').mockReset().mockResolvedValue(undefined as never);
  });

  it('two drains: the record is uploaded, never deleted in the cloud', async () => {
    // Настоящий маркер на диске — его не снимаем после сидинга, иначе тест
    // проверял бы пустой журнал.
    localStorage.setItem('ai_sync_pending_deletes', JSON.stringify([{ uid: USER, store: 'aiPortrait', key: 'p1' }]));
    expect(getPendingStoreDeleteKeys(USER)?.has('aiPortrait:p1')).toBe(true);

    const tab = new LocalStoreSyncManager();
    tab.scheduleStoreSync('aiPortrait', 'p1');
    // Проверка «есть ли запись в IndexedDB» — fire-and-forget, ждём её.
    await new Promise(r => setTimeout(r, 50));

    await tab.flushPending(true);
    await tab.flushPending(true);

    expect(DataProvider.deleteLocalStoreRecord, 'живая запись не должна быть удалена в облаке')
      .not.toHaveBeenCalledWith(USER, 'aiPortrait', 'p1');
    expect(DataProvider.saveLocalStoreRecordIfUnstamped).toHaveBeenCalledWith(USER, 'aiPortrait', 'p1', expect.anything(), null);
    expect(getPendingStoreDeleteKeys(USER)?.size).toBe(0);
    expect(getLocalStoreSyncSummary(USER)).toEqual({ pending: 0, dead: 0, oversized: 0, unknown: false });
  });

  // R3 §4.1.1 (a): ручной «Отправить всё» выгружал живую запись, а маркер
  // удаления оставлял — следующий дренаж сносил облачный ряд этой же записи.
  it('syncAllLocalStores drops the marker of a record it uploads', async () => {
    localStorage.setItem('ai_sync_pending_deletes', JSON.stringify([{ uid: USER, store: 'aiPortrait', key: 'p1' }]));
    const tab = new LocalStoreSyncManager();
    await tab.syncAllLocalStores(USER);
    await tab.flushPending(true);

    expect(DataProvider.deleteLocalStoreRecord).not.toHaveBeenCalledWith(USER, 'aiPortrait', 'p1');
    expect(getPendingStoreDeleteKeys(USER)?.size).toBe(0);
  });
});
