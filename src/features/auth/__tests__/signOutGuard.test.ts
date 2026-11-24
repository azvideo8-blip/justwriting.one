import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../core/storage/localDb';
import { countUnsyncedLocalData } from '../services/unsyncedLocalData';
import { countLocalDataInventory } from '../services/localDataInventory';

const USER = 'user_1';
const AI_JOURNAL = `ai_sync_pending_upserts:${USER}`;

async function reset() {
  localStorage.removeItem(AI_JOURNAL);
  const db = await getLocalDb(USER);
  for (const store of ['documents', 'syncQueue', 'drafts'] as const) {
    const all = await db.getAll(store);
    for (const rec of all) {
      const key = store === 'drafts'
        ? (rec as { userId: string }).userId
        : (rec as { id: string }).id;
      await db.delete(store, key);
    }
  }
  return db;
}

const note = (id: string, over: Record<string, unknown> = {}) => ({
  id, guestId: USER, title: 'n', currentVersion: 1, totalWords: 1,
  totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1,
  tags: [], ...over,
});

// Signing out clears every local store. That is right on a shared machine and
// safe while the cloud holds a copy — but for a local-only note, a queued edit
// or an unfinished draft it destroys the only copy there is, under a UI that
// promises "всё восстановится из облака".
describe('countUnsyncedLocalData', () => {
  beforeEach(reset);

  it('counts nothing when every note has a cloud copy', async () => {
    const db = await getLocalDb(USER);
    await db.put('documents', note('local_a', { linkedCloudId: 'cloud_a' }) as never);

    expect(await countUnsyncedLocalData(USER)).toMatchObject({ total: 0 });
  });

  it('counts a note that exists only on this device', async () => {
    const db = await getLocalDb(USER);
    await db.put('documents', note('local_b') as never);

    const out = await countUnsyncedLocalData(USER);
    expect(out.localOnly).toBe(1);
    expect(out.total).toBe(1);
  });

  it('counts a deliberately local-only note too — a wipe destroys it just the same', async () => {
    const db = await getLocalDb(USER);
    await db.put('documents', note('local_c', { localOnly: true }) as never);

    expect((await countUnsyncedLocalData(USER)).localOnly).toBe(1);
  });

  it('counts queued edits but not the concurrency lock', async () => {
    const db = await getLocalDb(USER);
    await db.put('syncQueue', { id: 'sync_1', documentId: 'local_a', type: 'document', createdAt: 1 } as never);
    await db.put('syncQueue', { id: 'lock_cloud_local_a', documentId: 'local_a', type: 'document', createdAt: 1 } as never);

    expect((await countUnsyncedLocalData(USER)).pending).toBe(1);
  });

  it('counts an unfinished draft, and ignores an empty one', async () => {
    const db = await getLocalDb(USER);
    await db.put('drafts', { userId: USER, title: '', content: 'начатая мысль', seconds: 0, wpm: 0, wordCount: 2, updatedAt: 1 } as never);
    expect((await countUnsyncedLocalData(USER)).drafts).toBe(1);

    await db.put('drafts', { userId: USER, title: '', content: '   ', seconds: 0, wpm: 0, wordCount: 0, updatedAt: 1 } as never);
    expect((await countUnsyncedLocalData(USER)).drafts).toBe(0);
  });

  // Подозрение дейлика 22.11 (окно выхода): стирание не видело неотправленное ИИ
  // и заметку, чья облачная копия отстаёт без задачи в очереди (переросла лимит).
  // Мутации: убрать ai / behind из счёта — красные.
  it('counts a linked note whose cloud copy is behind and has no queue task', async () => {
    const db = await getLocalDb(USER);
    await db.put('documents', note('local_e', { linkedCloudId: 'cloud_e', currentVersion: 3, lastSyncedCloudVersion: 2, isTooLargeForSync: true }) as never);
    expect(await countUnsyncedLocalData(USER)).toMatchObject({ behind: 1, total: 1 });

    // Та же правка в очереди — один раз, не дважды.
    await db.put('syncQueue', { id: 'sync_local_e', documentId: 'local_e', type: 'document', createdAt: 1 } as never);
    expect(await countUnsyncedLocalData(USER)).toMatchObject({ behind: 0, pending: 1, total: 1 });
  });

  // Ревью 0.11.25 N-6: метка неизвестна, а заметка велика для выгрузки — в облако не уедет никогда.
  it('counts an oversized linked note whose sync mark is unknown', async () => {
    const db = await getLocalDb(USER);
    await db.put('documents', note('local_g', { linkedCloudId: 'cloud_g', currentVersion: 3, isTooLargeForSync: true }) as never);
    expect((await countUnsyncedLocalData(USER)).behind).toBe(1);
  });

  it('counts AI data not yet sent (a dialogue with the companion)', async () => {
    localStorage.setItem(AI_JOURNAL, JSON.stringify([
      { uid: USER, store: 'aiDialogues', key: 'd1' },
      { uid: 'someone_else', store: 'aiDialogues', key: 'd2' },
    ]));
    expect(await countUnsyncedLocalData(USER)).toMatchObject({ ai: 1, total: 1 });
    localStorage.removeItem(AI_JOURNAL);
  });

  it('an unreadable AI journal is «could not check», not zero', async () => {
    localStorage.setItem(AI_JOURNAL, '{broken');
    expect(await countUnsyncedLocalData(USER)).toMatchObject({ ai: null, total: 0 });
    // Опись окна выхода: «не удалось проверить», а не «всё отправлено».
    expect((await countLocalDataInventory(USER)).unsyncedNotesCount).toBeNull();
    localStorage.removeItem(AI_JOURNAL);
  });

  it('ignores another account\'s notes', async () => {
    const db = await getLocalDb(USER);
    await db.put('documents', note('local_d', { guestId: 'someone_else' }) as never);

    expect((await countUnsyncedLocalData(USER)).total).toBe(0);
  });
});

describe('signOut', () => {
  beforeEach(async () => {
    await reset();
    vi.resetModules();
  });

  it('keeps local data by default without calling clearAllLocalStores', async () => {
    const db = await getLocalDb(USER);
    await db.put('documents', note('local_default') as never);

    const cleared = vi.fn();
    const signOutFn = vi.fn();
    vi.doMock('../../../core/storage/localDb', async () => ({
      ...(await vi.importActual<typeof import('../../../core/storage/localDb')>('../../../core/storage/localDb')),
      clearAllLocalStores: cleared,
    }));
    vi.doMock('../../../core/auth', () => ({
      getCurrentUserId: () => USER,
      getCurrentUser: () => ({ uid: USER }),
      signOutUser: signOutFn,
    }));
    vi.doMock('../../../core/crypto/keyVaultCache', () => ({
      clearDeviceKey: vi.fn(),
    }));
    vi.doMock('../../../core/crypto/useEncryptionStore', () => ({
      useEncryptionStore: { getState: () => ({ setKey: vi.fn() }) },
    }));

    const { AuthService } = await import('../services/AuthService');
    await AuthService.signOut();

    expect(cleared).not.toHaveBeenCalled();
    expect(signOutFn).toHaveBeenCalled();
  });

  it('refuses to wipe the device when clearLocalData is true and unsynced data exists', async () => {
    const db = await getLocalDb(USER);
    await db.put('documents', note('local_e') as never);

    const cleared = vi.fn();
    vi.doMock('../../../core/storage/localDb', async () => ({
      ...(await vi.importActual<typeof import('../../../core/storage/localDb')>('../../../core/storage/localDb')),
      clearAllLocalStores: cleared,
    }));
    vi.doMock('../../../core/auth', () => ({
      getCurrentUserId: () => USER,
      getCurrentUser: () => ({ uid: USER }),
      signOutUser: vi.fn(),
    }));

    const { AuthService } = await import('../services/AuthService');
    await expect(AuthService.signOut({ clearLocalData: true })).rejects.toMatchObject({
      name: 'UnsyncedLocalDataError',
      data: { localOnly: 1, total: 1 },
    });
    expect(cleared).not.toHaveBeenCalled();
  });

  // Мутация: убрать `unsynced.ai === null` в signOut — красный (стёрто без вопроса).
  it('refuses to wipe when the AI journal cannot be read', async () => {
    localStorage.setItem(AI_JOURNAL, '{broken');
    const cleared = vi.fn();
    vi.doMock('../../../core/storage/localDb', async () => ({
      ...(await vi.importActual<typeof import('../../../core/storage/localDb')>('../../../core/storage/localDb')),
      clearAllLocalStores: cleared,
    }));
    vi.doMock('../../../core/auth', () => ({
      getCurrentUserId: () => USER,
      getCurrentUser: () => ({ uid: USER }),
      signOutUser: vi.fn(),
    }));

    const { AuthService } = await import('../services/AuthService');
    await expect(AuthService.signOut({ clearLocalData: true })).rejects.toMatchObject({ name: 'UnsyncedLocalDataError' });
    expect(cleared).not.toHaveBeenCalled();
    localStorage.removeItem(AI_JOURNAL);
  });

  // A1: force sign-out proceeds even with unsynced data
  it('force sign-out clears data even when unsynced data exists', async () => {
    const db = await getLocalDb(USER);
    await db.put('documents', note('local_f') as never);

    const cleared = vi.fn();
    const firebaseSignOutFn = vi.fn();
    vi.doMock('../../../core/storage/localDb', async () => ({
      ...(await vi.importActual<typeof import('../../../core/storage/localDb')>('../../../core/storage/localDb')),
      clearAllLocalStores: cleared,
    }));
    vi.doMock('../../../core/auth', () => ({
      getCurrentUserId: () => USER,
      getCurrentUser: () => ({ uid: USER }),
      signOutUser: firebaseSignOutFn,
    }));
    vi.doMock('../../../core/crypto/keyVaultCache', () => ({
      clearDeviceKey: vi.fn(),
    }));
    vi.doMock('../../../core/crypto/useEncryptionStore', () => ({
      useEncryptionStore: { getState: () => ({ setKey: vi.fn() }) },
    }));

    const { AuthService } = await import('../services/AuthService');
    await AuthService.signOut({ clearLocalData: true, force: true });

    expect(cleared).toHaveBeenCalled();
    expect(firebaseSignOutFn).toHaveBeenCalled();
  });

  // AUD-11: провал очистки не должен выглядеть успехом. Выход состоялся
  // (signOutUser вызван), но наружу уходит LocalWipeFailedError, чтобы диалог
  // показал ошибку вместо «локальные данные удалены».
  it('reports a failed wipe after completing sign-out (AUD-11)', async () => {
    const cleared = vi.fn().mockRejectedValue(new Error('db locked'));
    const signOutFn = vi.fn();
    vi.doMock('../../../core/storage/localDb', async () => ({
      ...(await vi.importActual<typeof import('../../../core/storage/localDb')>('../../../core/storage/localDb')),
      clearAllLocalStores: cleared,
    }));
    vi.doMock('../../../core/auth', () => ({
      getCurrentUserId: () => USER,
      getCurrentUser: () => ({ uid: USER }),
      signOutUser: signOutFn,
    }));
    vi.doMock('../../../core/crypto/keyVaultCache', () => ({
      clearDeviceKey: vi.fn(),
    }));
    vi.doMock('../../../core/crypto/useEncryptionStore', () => ({
      useEncryptionStore: { getState: () => ({ lockVault: vi.fn() }) },
    }));
    vi.doMock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

    const { AuthService } = await import('../services/AuthService');
    await expect(AuthService.signOut({ clearLocalData: true, force: true })).rejects.toMatchObject({
      name: 'LocalWipeFailedError',
    });
    expect(signOutFn).toHaveBeenCalled();
  });


});

