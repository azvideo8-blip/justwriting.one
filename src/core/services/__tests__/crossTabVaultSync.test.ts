import { describe, it, expect, vi, beforeEach, onTestFinished } from 'vitest';
import 'fake-indexeddb/auto';
import { SyncService } from '../SyncService';
import { getLocalDb } from '../../storage/localDb';
import {
  useEncryptionStore,
  setupEncryptionStoreListeners,
  cleanupEncryptionStoreListeners,
  isAnyTabVaultUnlocked,
  VAULT_UNLOCKED_EVENT,
} from '../../crypto/useEncryptionStore';

const USER = 'user_vault_test';

vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: USER, isAnonymous: false }),
  getCurrentUserId: () => USER,
}));

vi.mock('../../sync/cloudSyncEnabled', () => ({
  cloudSyncEnabled: () => true,
}));

describe('DEEP-4: vault per-tab cross-tab broadcast and retryable sync', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    cleanupEncryptionStoreListeners();
    localStorage.clear();
    const db = await getLocalDb();
    await db.clear('syncQueue');
    useEncryptionStore.getState().lockVault();
  });

  it('tasks failing due to locked vault are quarantined immediately and then revived', async () => {
    // AUDIT-H4 + DEEP-4: LOCKED is deterministic — retrying an impossible
    // decrypt 10 times wastes resources. The broadcast channel's
    // reviveLockedTasks() restores the task when the vault actually opens.
    const db = await getLocalDb();
    await db.put('syncQueue', {
      id: 'task_locked_1',
      documentId: 'doc_1',
      type: 'document',
      createdAt: Date.now(),
      attempts: 0,
      dead: false,
      ownerId: USER,
    });

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { StorageService } = await import('../StorageService');
    const spy = vi.spyOn(StorageService, 'addCloudCopy').mockRejectedValueOnce(new Error('LOCKED: vault is locked'));

    await SyncService.syncPending(USER);

    const task = await db.get('syncQueue', 'task_locked_1');
    expect(task).toBeDefined();
    expect(task?.attempts).toBe(1);
    // LOCKED is deterministic: quarantined on the first attempt.
    expect(task?.dead).toBe(true);
    expect(task?.lastError).toContain('LOCKED');

    // reviveLockedTasks() un-quarantines it when the vault opens.
    const revivedCount = await SyncService.reviveLockedTasks(USER);
    expect(revivedCount).toBe(1);
    const revived = await db.get('syncQueue', 'task_locked_1');
    expect(revived?.dead).toBe(false);
    expect(revived?.attempts).toBe(0);

    spy.mockRestore();
  });

  it('reviveLockedTasks revives dead-lettered locked tasks and resets attempts', async () => {
    const db = await getLocalDb();
    await db.put('syncQueue', {
      id: 'task_dead_locked',
      documentId: 'doc_1',
      type: 'document',
      createdAt: Date.now(),
      attempts: 10,
      dead: true,
      lastError: 'Error: LOCKED: note is encrypted',
      ownerId: USER,
    });

    const revivedCount = await SyncService.reviveLockedTasks(USER);
    expect(revivedCount).toBe(1);

    const task = await db.get('syncQueue', 'task_dead_locked');
    expect(task?.dead).toBe(false);
    expect(task?.attempts).toBe(0);
  });

  it('isAnyTabVaultUnlocked reports true when another tab has recently refreshed heartbeat', () => {
    expect(isAnyTabVaultUnlocked()).toBe(false);

    // Simulate another tab heartbeating into localStorage
    localStorage.setItem('jw_vault_unlocked_time', String(Date.now() - 5000));
    expect(isAnyTabVaultUnlocked()).toBe(true);

    // Expired heartbeat (> 25s)
    localStorage.setItem('jw_vault_unlocked_time', String(Date.now() - 30_000));
    expect(isAnyTabVaultUnlocked()).toBe(false);
  });

  it('BroadcastChannel VAULT_UNLOCKED message triggers reviveLockedTasks', async () => {
    setupEncryptionStoreListeners();

    let unlockedEvents = 0;
    const countUnlocked = () => { unlockedEvents++; };
    window.addEventListener(VAULT_UNLOCKED_EVENT, countUnlocked);
    onTestFinished(() => window.removeEventListener(VAULT_UNLOCKED_EVENT, countUnlocked));

    const db = await getLocalDb();
    await db.put('syncQueue', {
      id: 'task_broadcast_test',
      documentId: 'doc_broadcast',
      type: 'document',
      createdAt: Date.now(),
      attempts: 10,
      dead: true,
      lastError: 'LOCKED',
      ownerId: USER,
    });

    // Simulate another tab posting VAULT_UNLOCKED to BroadcastChannel
    const channel = new BroadcastChannel('jw_vault_state');
    channel.postMessage({ type: 'VAULT_UNLOCKED', timestamp: Date.now() });

    // Ждём доставки сообщения
    await new Promise(r => setTimeout(r, 50));

    // Стор не зовёт синхронизацию напрямую — иначе модули замыкаются в цикл, —
    // а объявляет событие. Проверяется здесь именно оно; что на него подписан
    // AppProviders и что подписка действительно оживляет задачу, проверяет
    // тест ниже. Две половины одной цепочки, обе покрыты.
    expect(unlockedEvents, 'сообщение из соседней вкладки обязано объявить открытие сейфа').toBe(1);

    // И сама операция, ради которой всё затевалось, работает на этой задаче.
    await SyncService.reviveLockedTasks(USER);
    const task = await db.get('syncQueue', 'task_broadcast_test');
    expect(task?.dead).toBe(false);
    expect(task?.attempts).toBe(0);

    channel.close();
    cleanupEncryptionStoreListeners();
  });
});
