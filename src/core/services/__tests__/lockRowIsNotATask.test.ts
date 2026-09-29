import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

/**
 * A-3 (R2-009, R2-010) — строка замка не является задачей очереди.
 *
 * `lock_cloud_<id>` лежит в том же сторе `syncQueue`, что и задачи выгрузки, и
 * два места об этом забыли:
 *
 * 1) `dropQueueTasksFor` снимал ВСЕ строки с documentId заметки, включая замок.
 *    Он вызывается внутри критической секции, поэтому владелец терял собственный
 *    замок: heartbeat обновляет только строку со своим ownerToken, назад она не
 *    возвращается, и вторая вкладка входит в ту же секцию, пока первая там.
 * 2) `sweepOrphanedDocuments` считал заметку «уже в очереди» по любой строке с
 *    её documentId — осколок замка от закрытой вкладки держал заметку вне ссыпа.
 */

const USER = 'user_a3_lockrow';
type LockRow = { id: string; documentId: string; ownerToken?: string | undefined } | undefined;
const BURIED = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const LOCK = 'lock_cloud_local_1';
const DUPLICATE = Object.assign(
  new Error('duplicate key value violates unique constraint "documents_uuid_key"'),
  { code: '23505' },
);

const createDocument = vi.fn();
const findByUuid = vi.fn();
const getDocumentWithDeleted = vi.fn();
const addActivity = vi.fn();

vi.mock('../DocumentService', () => ({
  DocumentService: {
    createDocument: (...a: unknown[]) => createDocument(...a),
    findByUuid: (...a: unknown[]) => findByUuid(...a),
    getDocumentWithDeleted: (...a: unknown[]) => getDocumentWithDeleted(...a),
    getDocument: vi.fn(async () => null),
    getUserDocuments: vi.fn(async () => []),
    updateDocumentAfterSession: vi.fn(async () => undefined),
  },
}));
vi.mock('../VersionService', () => ({
  VersionService: { getVersions: vi.fn(async () => []), addVersion: vi.fn(async () => undefined) },
}));
vi.mock('../../../shared/activity/useActivityLogStore', () => ({
  useActivityLogStore: { getState: () => ({ addActivity }) },
}));

const { CloudSyncService } = await import('../CloudSyncService');
const { SyncService } = await import('../SyncService');
const { getLocalDb } = await import('../../storage/localDb');
const cloudSyncModule = await import('../../sync/cloudSyncEnabled');

async function seedUploadedNote(over: Record<string, unknown> = {}) {
  const db = await getLocalDb(USER);
  for (const r of await db.getAll('documents')) await db.delete('documents', (r as { id: string }).id);
  for (const r of await db.getAll('syncQueue')) await db.delete('syncQueue', (r as { id: string }).id);
  await db.put('documents', {
    id: 'local_1', guestId: USER, uuid: BURIED, title: 'Note with a buried uuid',
    currentVersion: 1, totalWords: 400, totalDuration: 0, sessionsCount: 1,
    firstSessionAt: 1, lastSessionAt: 1, tags: [], linkedCloudId: '',
    ...over,
  } as never);
  await db.put('syncQueue', { id: 'sync_local_1', documentId: 'local_1', createdAt: Date.now() } as never);
  return db;
}

describe('A-3: the lock row is not a queue task', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(cloudSyncModule, 'cloudSyncEnabled').mockReturnValue(true);
    createDocument.mockRejectedValue(DUPLICATE);
    findByUuid.mockResolvedValue(null);
    getDocumentWithDeleted.mockResolvedValue({ id: BURIED, uuid: BURIED, deletedAt: new Date() });
    addActivity.mockReturnValue(undefined);
  });

  it('dropQueueTasksFor leaves the caller’s own lock in place', async () => {
    const db = await seedUploadedNote();
    let lockBefore: LockRow;
    // Надгробие находится ДО снятия задач; addActivity вызывается сразу после.
    getDocumentWithDeleted.mockImplementation(async () => {
      lockBefore = await db.get('syncQueue', LOCK) as LockRow;
      return { id: BURIED, uuid: BURIED, deletedAt: new Date() };
    });
    // Транзакция открывается синхронно внутри секции, поэтому её значение —
    // состояние замка до того, как withDocumentLock его отпустит.
    let probeAfterDrop: Promise<LockRow> = Promise.resolve(undefined);
    addActivity.mockImplementation(() => {
      probeAfterDrop = db.transaction('syncQueue', 'readonly').store.get(LOCK) as Promise<LockRow>;
    });

    await CloudSyncService.addCloudCopy(USER, 'local_1');

    expect(lockBefore?.ownerToken, 'замок взят — секция под ним').toBeTruthy();
    const lockAfter = await probeAfterDrop;
    expect(lockAfter?.ownerToken, 'снятие задач очереди не снимает замок').toBe(lockBefore?.ownerToken);
    // Обычные задачи заметки при этом сняты — иначе «починка» была бы заглушкой.
    expect(await db.get('syncQueue', 'sync_local_1')).toBeUndefined();
  });

  it('an abandoned lock row does not keep the note out of the orphan sweep', async () => {
    const db = await seedUploadedNote({
      firstSessionAt: Date.now() - 10 * 60 * 1000,
      lastSessionAt: Date.now() - 10 * 60 * 1000,
    });
    // Своей задачи у заметки нет — в очереди только осколок замка.
    await db.delete('syncQueue', 'sync_local_1');
    await db.put('syncQueue', {
      id: LOCK,
      documentId: 'local_1',
      type: 'document' as const,
      createdAt: Date.now() - 10 * 60 * 1000,
      ownerToken: 'closed_tab',
    } as never);

    const res = await SyncService.sweepOrphanedDocuments(USER, 5 * 60 * 1000);

    expect(res.enqueued, 'замок — не задача очереди, заметка ссыпается').toBe(1);
    const queued = (await db.getAll('syncQueue')).filter(q => q.documentId === 'local_1' && !q.id.startsWith('lock_cloud_'));
    expect(queued).toHaveLength(1);
  });
});
