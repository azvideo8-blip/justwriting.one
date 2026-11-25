// Дейлик 25.11, PR-1: отложенное удаление облачной заметки. Настоящие StorageService /
// SyncService / CloudSyncService / UnifiedSessionLoader / useLifeLog поверх fake-indexeddb;
// подменён край облака (DataProvider).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

const cloud = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  versions: [] as Record<string, unknown>[],
  changes: [] as Record<string, unknown>[],
  versionChanges: [] as Record<string, unknown>[],
  deleteDocument: vi.fn(),
  updateDocument: vi.fn(),
  getVersions: vi.fn(),
}));
vi.mock('../../data', () => ({
  DataProvider: {
    getUserDocuments: async () => cloud.rows,
    getDocument: async (_u: string, id: string) => cloud.rows.find(r => r.id === id) ?? null,
    getDocumentsByUuidsWithDeleted: async (_u: string, ids: string[]) => cloud.rows.filter(r => ids.includes(String(r.id))),
    getVersions: cloud.getVersions,
    deleteDocument: cloud.deleteDocument,
    updateDocument: cloud.updateDocument,
  },
}));
vi.mock('../../data/providers/pullChanges', async importOriginal => ({
  ...(await importOriginal<typeof import('../../data/providers/pullChanges')>()),
  pullChangesSince: async (_u: string, table: string, since: number) => ({
    rows: (table === 'documents' ? cloud.changes : cloud.versionChanges).filter(r => Number(r.rev) > since),
  }),
}));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { renderHook, waitFor } from '@testing-library/react';
import { reportError } from '../../../shared/errors/reportError';
import { getLocalDb } from '../../storage/localDb';
import { StorageService } from '../StorageService';
import { SyncService } from '../SyncService';
import { CloudSyncService } from '../CloudSyncService';
import { LocalDocumentService } from '../LocalDocumentService';
import { loadAllSessions } from '../UnifiedSessionLoader';
import { useLifeLog } from '../../../features/writing/hooks/useLifeLog';
import { getSyncRevCursor } from '../../sync/revCursor';
import { setEncryptionEnabled, setProfileLoaded } from '../../crypto/cryptoHelpers';
import { LanguageProvider } from '../../../shared/i18n';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import type { AppUser } from '../../auth/types';

const U = 'u_d45';
const CLOUD = 'cloud_d45';
const OTHER = 'cloud_other_d45';
const user = { uid: U } as unknown as AppUser;
const day = '2026-11-01T12:00:00.000Z';

const row = (id: string) => ({
  id, uuid: id, userId: U, title: 'Синтетическая', currentVersion: 1, totalWords: 1, totalDuration: 0,
  sessionsCount: 1, firstSessionAt: day, lastSessionAt: day, createdAt: day, updatedAt: day,
});
const version = (id: string) => ({
  id: `v_${id}`, uuid: `v_${id}`, documentId: id, documentUuid: id, userId: U, version: 1, content: 'синтетический текст',
  wordCount: 2, duration: 0, wpm: 0, sessionStartedAt: day, savedAt: day,
});
const change = (id: string, rev: number) => ({
  uuid: id, user_id: U, rev, title: 'Синтетическая', tags: [], current_version: 1, total_words: 1, total_duration: 0,
  sessions_count: 1, first_session_at: day, last_session_at: day, created_at: day, updated_at: day, deleted_at: null,
});

const deleteTasks = async () => (await (await getLocalDb(U)).getAll('syncQueue')).filter(t => t.type === 'delete');
const listed = async () => (await loadAllSessions(U, user)).sessions.map(s => s._linkedCloudId);
const localLinks = async () => (await LocalDocumentService.getDocumentsByOwner(U)).map(d => d.linkedCloudId);
async function quarantine() {
  const [task] = await deleteTasks();
  await (await getLocalDb(U)).put('syncQueue', { ...task!, dead: true, attempts: 10 });
}

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  setProfileLoaded(U, true);
  setEncryptionEnabled(U, false);
  localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(U), 'true');
  cloud.rows = [row(CLOUD), row(OTHER)];
  cloud.changes = [change(CLOUD, 1), change(OTHER, 2)];
  cloud.versionChanges = [];
  cloud.getVersions.mockImplementation(async (_u: string, id: string) => [version(id)]);
  cloud.deleteDocument.mockRejectedValue(new Error('503'));
  cloud.updateDocument.mockResolvedValue(undefined);
  const db = await getLocalDb(U);
  for (const s of ['documents', 'versions', 'syncQueue', 'profile'] as const) await db.clear(s);
});

describe('удаление ждёт облака', () => {
  it('синхронизация выключена: удаление уходит, прочее — нет', async () => {
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(U), 'false');
    await StorageService.deleteDocument(U, undefined, CLOUD);
    const db = await getLocalDb(U);
    await db.put('syncQueue', { id: 'sync_note', documentId: 'note', type: 'document', createdAt: 1, ownerId: U });
    await db.put('syncQueue', { id: 'delete_theirs', documentId: 'x', type: 'delete', createdAt: 1, ownerId: 'u_other', revocable: true });
    const upload = vi.spyOn(StorageService, 'addCloudCopy').mockResolvedValue('');
    const relink = vi.spyOn(CloudSyncService, 'relinkOrphanedDocuments');
    cloud.deleteDocument.mockClear();
    cloud.deleteDocument.mockResolvedValue(undefined);

    const res = await SyncService.syncPending(U);
    expect(res).toMatchObject({ drained: 1, failed: 0, skippedReason: 'sync_disabled' });
    expect(cloud.deleteDocument.mock.calls).toEqual([[U, CLOUD]]);
    expect(upload).not.toHaveBeenCalled();
    expect(relink).not.toHaveBeenCalled();
    expect((await db.getAll('syncQueue')).map(t => t.id)).toEqual(['delete_theirs', 'sync_note']);
    // Фоновый проход каждые две минуты: о чужих задачах при выключенной синхронизации молчим.
    expect(reportError).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'drainPendingQueue_foreignOwner' }), 'warning');
    // Явное действие человека уносит и остальное.
    await SyncService.syncPending(U, { force: true });
    expect(upload).toHaveBeenCalledWith(U, 'note');
  });

  // Ревью PR-1: задача до 0.11.27 могла пережить «Восстановить» — не исполняется никаким входом.
  it.each([
    ['синхронизация выключена', 'false', () => SyncService.syncPending(U)],
    ['синхронизация включена', 'true', () => SyncService.syncPending(U)],
    ['«Отправить все»', 'false', () => SyncService.syncAllUnlinked(U)],
  ])('старая задача (%s): снята, облако не тронуто, заметка видна', async (_n, sync, run) => {
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(U), sync);
    await (await getLocalDb(U)).put('syncQueue', { id: 'delete_old', documentId: CLOUD, type: 'delete', createdAt: 1, ownerId: U });
    cloud.deleteDocument.mockResolvedValue(undefined);
    expect(await listed()).toEqual(expect.arrayContaining([CLOUD, OTHER]));
    await run();
    expect(cloud.deleteDocument).not.toHaveBeenCalled();
    expect(await deleteTasks()).toEqual([]);
    expect(await listed()).toEqual(expect.arrayContaining([CLOUD, OTHER]));
  });

  // Ревью 142fa421: проход решил снять старую задачу, а пока он выгружал заметки, человек
  // удалил ту же заметку. Мутация: не менять updatedAt при переводе задачи — красный.
  it('удаление, поставленное посреди прохода, снимающего старую задачу, остаётся в очереди', async () => {
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(U), 'true');
    const db = await getLocalDb(U);
    await db.put('syncQueue', { id: 'delete_old', documentId: CLOUD, type: 'delete', createdAt: 1, ownerId: U });
    await db.put('syncQueue', { id: 'sync_note', documentId: 'note', type: 'document', createdAt: 2, ownerId: U });
    cloud.deleteDocument.mockRejectedValue(new Error('503'));
    const upload = vi.spyOn(StorageService, 'addCloudCopy').mockImplementation(async () => {
      await StorageService.deleteDocument(U, undefined, CLOUD);
      return 'cloud_note';
    });
    await SyncService.syncPending(U);
    expect(upload).toHaveBeenCalled();
    upload.mockRestore();
    expect(await deleteTasks()).toMatchObject([{ documentId: CLOUD, revocable: true }]);
    expect(await listed()).toEqual([OTHER]);
  });

  it('новое удаление той же заметки переводит старую задачу в новые', async () => {
    await (await getLocalDb(U)).put('syncQueue', { id: 'delete_old', documentId: CLOUD, type: 'delete', createdAt: 1, ownerId: U });
    await StorageService.deleteDocument(U, undefined, CLOUD);
    expect(await deleteTasks()).toMatchObject([{ id: 'delete_old', revocable: true }]);
    expect(await listed()).toEqual([OTHER]);
  });

  it('локальная заметка с облачной копией: удаление уходит и при выключенной синхронизации', async () => {
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(U), 'false');
    const { localId } = await CloudSyncService.addLocalCopy(U, CLOUD);
    await StorageService.deleteDocument(U, localId);
    expect(await deleteTasks()).toMatchObject([{ documentId: CLOUD, revocable: true }]);
    cloud.deleteDocument.mockResolvedValue(undefined);
    expect(await SyncService.syncPending(U)).toMatchObject({ drained: 1 });
    expect(await deleteTasks()).toEqual([]);
  });

  // Ревью PR-1, 2 и 4: заметка жива на устройстве — задача устарела.
  it.each([
    ['связана', { linkedCloudId: CLOUD }],
    ['тот же uuid', { uuid: CLOUD }],
  ])('заметка жива на устройстве (%s): облако не трогаем, задачу снимаем', async (_n, over) => {
    await StorageService.deleteDocument(U, undefined, CLOUD);
    await (await getLocalDb(U)).put('documents', {
      id: 'loc_alive', guestId: U, title: 'жива', currentVersion: 1, totalWords: 1, totalDuration: 0, sessionsCount: 1,
      firstSessionAt: 1, lastSessionAt: 1, tags: [], localOnly: true, ...over,
    } as never);
    cloud.deleteDocument.mockClear();
    cloud.deleteDocument.mockResolvedValue(undefined);
    await SyncService.syncPending(U);
    expect(cloud.deleteDocument).not.toHaveBeenCalled();
    expect(await deleteTasks()).toEqual([]);
  });

  // Ревью PR-1, 3: чужая несвязанная заметка с тем же началом к удаляемой строке не цепляется.
  it('перепривязка по времени обходит строку, ждущую удаления', async () => {
    const db = await getLocalDb(U);
    const orphan = { id: 'loc_orphan', uuid: 'uuid-orphan', guestId: U, title: 'Синтетическая', currentVersion: 1, totalWords: 1,
      totalDuration: 0, sessionsCount: 1, firstSessionAt: Date.parse(day), lastSessionAt: Date.parse(day), tags: [] };
    cloud.rows = [row(CLOUD)];
    await db.put('documents', orphan as never);
    expect((await CloudSyncService.relinkOrphanedDocuments(U)).relinked).toBe(1); // без удаления — пара
    await db.put('documents', orphan as never);
    await StorageService.deleteDocument(U, undefined, CLOUD);
    expect((await CloudSyncService.relinkOrphanedDocuments(U)).relinked).toBe(0);
    expect((await db.get('documents', 'loc_orphan'))?.linkedCloudId).toBeUndefined();
    // Тот же uuid — сама заметка, она жива на устройстве: пара остаётся.
    await db.put('documents', { ...orphan, uuid: CLOUD } as never);
    expect((await CloudSyncService.relinkOrphanedDocuments(U)).relinked).toBe(1);
  });

  it('задача другой учётки не прячет', async () => {
    await (await getLocalDb(U)).put('syncQueue', { id: 'd', documentId: CLOUD, type: 'delete', createdAt: 1, ownerId: 'u_other', revocable: true });
    expect(await listed()).toEqual(expect.arrayContaining([CLOUD, OTHER]));
  });

  it('список и журнал письма не показывают заметку, чьё удаление ждёт облака', async () => {
    expect(await listed()).toEqual(expect.arrayContaining([CLOUD, OTHER]));
    await StorageService.deleteDocument(U, undefined, CLOUD);
    expect(await listed()).toEqual([OTHER]);
    const { result } = renderHook(() => useLifeLog(U, false), { wrapper: LanguageProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.unifiedDocuments.map(d => d.cloudId)).toEqual([OTHER]);
    expect(result.current.documents.map(d => d.id)).toEqual([OTHER]);
  });

  it('задача в карантине заметку не прячет и скачать не мешает', async () => {
    await StorageService.deleteDocument(U, undefined, CLOUD);
    await quarantine();
    expect(await listed()).toEqual(expect.arrayContaining([CLOUD, OTHER]));
    await CloudSyncService.addLocalCopy(U, CLOUD);
    expect(await localLinks()).toEqual([CLOUD]);
  });

  it('полное скачивание не возвращает удалённую, остальные скачивает', async () => {
    await StorageService.deleteDocument(U, undefined, CLOUD);
    const res = await CloudSyncService.downloadAllFromCloud(U);
    expect(res).toMatchObject({ downloaded: 1, skipped: 1, failed: 0 });
    expect(await localLinks()).toEqual([OTHER]);
    // Ни текста не читали, ни строки не заводили, ни ошибки в журнал.
    expect(cloud.getVersions.mock.calls.map(c => c[1])).toEqual([OTHER]);
    expect(reportError).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'addLocalCopy' }));
  });

  it('забор по rev не возвращает удалённую, остальные скачивает, курсор проходит обе', async () => {
    await StorageService.deleteDocument(U, undefined, CLOUD);
    const res = await CloudSyncService.pullNotesByRev(U);
    expect(res).toMatchObject({ downloaded: 1, skipped: 1, deferred: 0 });
    expect(await localLinks()).toEqual([OTHER]);
    expect((await getSyncRevCursor(U)).documents).toBe(2);
  });

  it('забор: приехала только версия удалённой заметки — тоже не возвращает', async () => {
    await StorageService.deleteDocument(U, undefined, CLOUD);
    cloud.changes = [];
    cloud.versionChanges = [{ uuid: 'v_x', document_uuid: CLOUD, user_id: U, version: 1, rev: 3 }];
    const res = await CloudSyncService.pullNotesByRev(U);
    expect(res).toMatchObject({ downloaded: 0, skipped: 1, deferred: 0 });
    expect(await localLinks()).toEqual([]);
    expect((await getSyncRevCursor(U)).versions).toBe(3);
  });

  it('удаление, принятое посреди скачивания, откатывает копию', async () => {
    cloud.getVersions.mockImplementation(async (_u: string, id: string) => {
      await StorageService.deleteDocument(U, undefined, id);
      return [version(id)];
    });
    await expect(CloudSyncService.addLocalCopy(U, CLOUD)).rejects.toThrow('PENDING_REMOVAL');
    expect(await localLinks()).toEqual([]);
    expect(await deleteTasks()).toHaveLength(1);
    expect(reportError).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'addLocalCopy' }));
  });

  // Ревью PR-1, E: удаление не проходит под скачиванием — замок строки общий.
  it.each(['прямое', 'дренаж'])('удаление (%s) во время скачивания ждёт, копии не остаётся', async kind => {
    cloud.deleteDocument.mockResolvedValue(undefined);
    cloud.getVersions.mockImplementation(async (_u: string, id: string) => {
      if (kind === 'прямое') expect(await StorageService.deleteDocument(U, undefined, id)).toMatchObject({ cloudSynced: false });
      else {
        await (await getLocalDb(U)).put('syncQueue', { id: 'del', documentId: id, type: 'delete', createdAt: 1, ownerId: U, revocable: true });
        await SyncService.syncPending(U);
      }
      return [version(id)];
    });
    await expect(CloudSyncService.addLocalCopy(U, CLOUD)).rejects.toThrow('PENDING_REMOVAL');
    expect(await localLinks()).toEqual([]);
    expect(cloud.deleteDocument).not.toHaveBeenCalled();
    expect(await deleteTasks()).toHaveLength(1);
  });

  it('повторное удаление оживляет задачу из карантина', async () => {
    await StorageService.deleteDocument(U, undefined, CLOUD);
    await quarantine();
    await StorageService.deleteDocument(U, undefined, CLOUD);
    const tasks = await deleteTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ dead: false, attempts: 0 });
  });
});

describe('восстановление против отложенного удаления', () => {
  it('снимает отложенное удаление', async () => {
    await StorageService.deleteDocument(U, undefined, CLOUD);
    await quarantine();
    await StorageService.restoreDocument(U, undefined, CLOUD);
    expect(cloud.updateDocument).toHaveBeenCalledWith(U, CLOUD, { trashedAt: null });
    expect(await deleteTasks()).toEqual([]);
  });

  it('дренаж перечитывает задачу: снятую восстановлением не исполняет', async () => {
    // Семь удалений при потолке 5: последние ждут места в очереди.
    const ids = Array.from({ length: 7 }, (_, i) => `cloud_q${i}`);
    cloud.rows = ids.map(row);
    for (const id of ids) await StorageService.deleteDocument(U, undefined, id);
    let go!: () => void;
    const gate = new Promise<void>(r => { go = r; });
    cloud.deleteDocument.mockClear();
    cloud.deleteDocument.mockImplementation(() => gate);
    const drain = SyncService.syncPending(U);
    await vi.waitFor(() => expect(cloud.deleteDocument).toHaveBeenCalledTimes(5));
    const started = cloud.deleteDocument.mock.calls.map(c => c[1] as string);
    const waiting = ids.filter(id => !started.includes(id));
    await StorageService.restoreDocument(U, undefined, waiting[0]);
    go();
    await drain;
    expect(cloud.deleteDocument.mock.calls.map(c => c[1])).not.toContain(waiting[0]);
    expect(cloud.deleteDocument.mock.calls.map(c => c[1])).toContain(waiting[1]);
  });

  it('восстановление ждёт летящее удаление: отказало — восстановлено, прошло — отказ', async () => {
    for (const passes of [false, true]) {
      cloud.rows = [row(CLOUD)];
      let finish!: () => void;
      cloud.deleteDocument.mockImplementation(() => new Promise<void>((res, rej) => {
        finish = () => { if (passes) { cloud.rows = []; res(); } else rej(new Error('503')); };
      }));
      cloud.deleteDocument.mockClear();
      const deleting = StorageService.deleteDocument(U, undefined, CLOUD);
      await vi.waitFor(() => expect(cloud.deleteDocument).toHaveBeenCalled());
      cloud.updateDocument.mockClear();
      const restoring = StorageService.restoreDocument(U, undefined, CLOUD).then(() => 'ok', e => String(e));
      await new Promise(res => setTimeout(res, 50));
      expect(cloud.updateDocument).not.toHaveBeenCalled();
      finish();
      expect(await deleting).toMatchObject({ cloudSynced: passes });
      expect(await restoring).toBe(passes ? 'Error: RESTORE_TARGET_GONE' : 'ok');
      expect(await deleteTasks()).toEqual([]);
    }
  });

  it('восстановили между постановкой и запросом — прямое удаление облака не трогает', async () => {
    const { localId } = await CloudSyncService.addLocalCopy(U, CLOUD);
    cloud.deleteDocument.mockResolvedValue(undefined);
    const real = LocalDocumentService.cascadeDeleteAIDerivatives;
    vi.spyOn(LocalDocumentService, 'cascadeDeleteAIDerivatives').mockImplementationOnce(async (...a) => {
      await StorageService.restoreDocument(U, undefined, CLOUD);
      return real(...a);
    });
    expect(await StorageService.deleteDocument(U, localId)).toMatchObject({ cloudSynced: false });
    expect(cloud.deleteDocument).not.toHaveBeenCalled();
  });

  it('ряда уже нет — «восстановлено» не говорим', async () => {
    cloud.updateDocument.mockImplementation(async () => { cloud.rows = []; });
    await expect(StorageService.restoreDocument(U, undefined, CLOUD)).rejects.toThrow('RESTORE_TARGET_GONE');
  });
});
