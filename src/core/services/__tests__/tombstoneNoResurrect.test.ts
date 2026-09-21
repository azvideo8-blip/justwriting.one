// AUDIT-H3: заметка, удалённая в облаке (deletedAt/tombstone), не должна
// воскреснуть: unlink обязан ставить localOnly, а syncAllUnlinked — не подхватывать.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';
import { SyncService } from '../SyncService';
import { StorageService, CLOUD_COPY_TOMBSTONE } from '../StorageService';

vi.mock('../../sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../data', () => ({
  DataProvider: {
    getLocalStoreRecord: vi.fn().mockResolvedValue(null),
    saveLocalStoreRecord: vi.fn().mockResolvedValue(undefined),
  },
}));

// Облачные сервисы мокаем на уровне модулей: управляем ответом getDocumentWithDeleted.
const getDocWithDeleted = vi.hoisted(() => vi.fn());
vi.mock('../DocumentService', () => ({
  DocumentService: {
    getUserDocuments: vi.fn().mockResolvedValue([]),
    getDocument: vi.fn(),
    getDocumentWithDeleted: (...a: unknown[]) => getDocWithDeleted(...(a as [])),
  },
}));
vi.mock('../VersionService', () => ({
  VersionService: {
    getVersions: vi.fn().mockResolvedValue([]),
    addVersion: vi.fn().mockResolvedValue(undefined),
  },
}));

const USER = 'user_tombstone';

async function seedLinked() {
  const db = await getLocalDb();
  await db.put('documents', {
    id: 'local_del', guestId: USER, title: 'Удалённая синтетическая', currentVersion: 1,
    totalWords: 1, totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1,
    tags: [], linkedCloudId: 'cloud_del',
  } as never);
}

beforeEach(async () => {
  const db = await getLocalDb();
  for (const rec of await db.getAll('documents')) await db.delete('documents', (rec as { id: string }).id);
  for (const rec of await db.getAll('syncQueue')) await db.delete('syncQueue', (rec as { id: string }).id);
  vi.restoreAllMocks();
});

describe('AUDIT-H3 tombstoned note must not resurrect via auto-upload', () => {
  it('addCloudCopy sees deletedAt → unlinks WITH localOnly; syncAllUnlinked skips it', async () => {
    await seedLinked();
    // Облачный документ — tombstone.
    getDocWithDeleted.mockResolvedValue({ id: 'cloud_del', deletedAt: new Date() });

    const cloudId = await StorageService.addCloudCopy(USER, 'local_del');
    expect(cloudId).toBe(CLOUD_COPY_TOMBSTONE);

    const db = await getLocalDb();
    const doc = await db.get('documents', 'local_del');
    expect(doc!.localOnly).toBe(true);   // ← без этого syncAllUnlinked воскресит заметку
    expect(doc!.linkedCloudId).toBe('');
  });

  it('mutation guard: plain unlink WITHOUT localOnly would be re-uploaded (documents the bug)', async () => {
    await seedLinked();
    // Воспроизводим СТАРОЕ поведение вручную: unlink без localOnly...
    const db = await getLocalDb();
    await db.put('documents', { ...(await db.get('documents', 'local_del'))!, linkedCloudId: '' });
    void getDocWithDeleted;

    const spy = vi.spyOn(StorageService, 'addCloudCopy').mockResolvedValue('cloud_new');
    const { synced } = await SyncService.syncAllUnlinked(USER);

    // ...и тогда автозаливка создала бы новый облачный документ (воскрешение).
    expect(synced).toBe(1);
    expect(spy).toHaveBeenCalledWith(expect.anything(), 'local_del');
    // А после фикса фильтр !d.localOnly отсекает такие заметки — этот тест
    // падал бы на старом коде только вместе с предыдущим ассертом localOnly.
  });

  it('after the fix, a localOnly note is never auto-uploaded', async () => {
    await seedLinked();
    const db = await getLocalDb();
    await db.put('documents', { ...(await db.get('documents', 'local_del'))!, linkedCloudId: '', localOnly: true });

    const spy = vi.spyOn(StorageService, 'addCloudCopy').mockResolvedValue('cloud_new');
    const { synced } = await SyncService.syncAllUnlinked(USER);

    expect(synced).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it('AG-DEL-3: syncVersionToCloud on tombstoned doc unlinks WITH localOnly', async () => {
    await seedLinked();
    getDocWithDeleted.mockResolvedValue({ id: 'cloud_del', deletedAt: new Date() });

    const { CloudSyncService } = await import('../CloudSyncService');
    const syncData = { title: 'Doc', content: 'new content', tags: [], wordCount: 2, duration: 10, wpm: 20, sessionStartedAt: new Date() };
    await CloudSyncService.syncVersionToCloud(USER, 'local_del', 'cloud_del', syncData, 2, 'prev content');

    const db = await getLocalDb();
    const doc = await db.get('documents', 'local_del');
    expect(doc!.localOnly).toBe(true);
    expect(doc!.linkedCloudId).toBe('');
  });
});

