import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { DocumentService, UnreadableCloudListError } from '../DocumentService';
import { CloudSyncService } from '../CloudSyncService';
import { loadAllSessions } from '../UnifiedSessionLoader';
import { checkAndSyncCursor, getStoredCursor, clearStoredCursor } from '../../sync/changeCursor';
import { getLocalDb, resetDbInstance } from '../../storage/localDb';
import { setProfileLoaded, setEncryptionEnabled } from '../../crypto/cryptoHelpers';

// S1-10: списочный читатель не отдаёт неполный список молча. Ряд, который не
// прошёл схему (`current_version: 'три'`), раньше превращался в `null` и тихо
// выпадал из списка: курсор изменений уезжал за неприменённое изменение,
// «нет в списке» читалось как «прочитано целиком», выгрузка «всё» была
// неполной без единого признака (дейли 2026-10-22). Теперь список с таким
// рядом — ошибка уровня списка: она несёт прочитанную часть и id нечитаемых;
// проход незавершён, курсор стоит; дренаж отказывает только несвязанным
// выгрузкам, чей uuid совпал с uuid нечитаемого ряда (R-1: раньше — всем
// несвязанным, и один битый ряд держал на устройстве каждую новую заметку).

const USER = 'user_s110_complete';
const LOCAL_ID = 'doc_s110';
const GOOD_CLOUD_ID = 'cloud_s110_good';
const BAD_CLOUD_ID = 'cloud_s110_bad';
const ORPHAN_UUID = 'uuid-orphan-s110';
const FOREIGN_UUID = 'uuid-foreign-s110';

function cloudRow(id: string, extra: Record<string, unknown> = {}) {
  // DataProvider отдаёт уже смапленные ряды (camelCase) — как настоящий провайдер.
  return {
    id,
    uuid: id,
    userId: USER,
    title: `Облачная заметка ${id}`,
    currentVersion: 2,
    totalWords: 5,
    totalDuration: 0,
    sessionsCount: 1,
    firstSessionAt: '2026-10-17T12:00:00.000Z',
    lastSessionAt: '2026-10-17T12:00:00.000Z',
    createdAt: '2026-10-17T12:00:00.000Z',
    updatedAt: '2026-10-17T12:00:00.000Z',
    ...extra,
  };
}

const GOOD_ROW = cloudRow(GOOD_CLOUD_ID);
// Ряд, который есть, но не проходит схему: `current_version` строкой.
const BAD_ROW = cloudRow(BAD_CLOUD_ID, { currentVersion: 'три' });

const getUserDocuments = vi.fn();

vi.mock('../../data', () => ({
  DataProvider: {
    getUserDocuments: (...args: unknown[]) => getUserDocuments(...args),
    getDocument: async () => null,
    getDocumentWithDeleted: async () => null,
    createDocument: async () => 'cloud_NEW',
    updateDocument: async () => {},
    updateDocumentSessionStats: async () => {},
    deleteDocument: async () => {},
    getVersions: async () => [],
  },
}));
vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: USER }),
  getCurrentUserId: () => USER,
}));
vi.mock('../../sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

function localDoc(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    uuid: `uuid-${id}`,
    guestId: USER,
    title: 'Моя заметка',
    currentVersion: 1,
    totalWords: 5,
    totalDuration: 10,
    sessionsCount: 1,
    firstSessionAt: Date.UTC(2026, 9, 17, 12, 0, 0),
    lastSessionAt: Date.UTC(2026, 9, 17, 12, 0, 0),
    tags: [],
    ...over,
  };
}

async function seedLocal(docs: Array<Record<string, unknown>>) {
  const db = await getLocalDb(USER);
  await db.clear('documents');
  await db.clear('versions');
  await db.clear('syncQueue');
  for (const d of docs) await db.put('documents', d as never);
}

const LINKED = localDoc(LOCAL_ID, {
  uuid: 'uuid-local-s110',
  linkedCloudId: GOOD_CLOUD_ID,
  localOnly: false,
  lastSyncedCloudVersion: 2,
  lastSeenCloudUpdatedAt: '2026-10-17T12:00:00.000Z',
});

describe('S1-10: полнота списочного читателя', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetDbInstance();
    setProfileLoaded(USER, true);
    setEncryptionEnabled(USER, false);
    clearStoredCursor(USER);
    await seedLocal([LINKED]);
  });

  it('getUserDocuments бросает UnreadableCloudListError с id нечитаемого ряда и прочитанной частью', async () => {
    getUserDocuments.mockResolvedValue([GOOD_ROW, BAD_ROW]);

    const err = await DocumentService.getUserDocuments(USER).catch(e => e);
    expect(err).toBeInstanceOf(UnreadableCloudListError);
    expect(err.ids).toEqual([BAD_CLOUD_ID]);
    expect(err.uuids, 'uuid сырого ряда едет с ошибкой').toEqual([BAD_CLOUD_ID]);
    expect(err.docs.map((d: { id: string }) => d.id)).toEqual([GOOD_CLOUD_ID]);
  });

  // R-2: сверка идёт по прочитанной части и сообщает неполноту результатом, а не броском.
  // Мутация «не ставить incomplete» → красный (здесь и в тесте курсора).
  it('reconcileLinkedDocuments сверяет прочитанное и сообщает неполноту списка', async () => {
    getUserDocuments.mockResolvedValue([GOOD_ROW, BAD_ROW]);

    const res = await CloudSyncService.reconcileLinkedDocuments(USER);
    expect(res.incomplete).toBe(true);
    expect(res.failed).toBe(0);
  });

  it('курсор не двигается, пока список неполный, и двигается после чистого прохода', async () => {
    getUserDocuments.mockResolvedValue([GOOD_ROW, BAD_ROW]);
    const cursor = '2026-10-18T12:00:00.000Z';

    await expect(
      checkAndSyncCursor(USER, {
        fetchServerCursorFn: async () => cursor,
        downloadAll: async () => ({ failed: 0 }),
      }),
    ).resolves.toMatchObject({ checked: true });
    expect(getStoredCursor(USER), 'сдвиг курсора по неполному списку не принимается').toBeNull();

    getUserDocuments.mockResolvedValue([GOOD_ROW]);
    await expect(
      checkAndSyncCursor(USER, {
        fetchServerCursorFn: async () => cursor,
        downloadAll: async () => ({ failed: 0 }),
      }),
    ).resolves.toMatchObject({ checked: true, synced: true });
    expect(getStoredCursor(USER)).toBe(cursor);
  });

  it('выгрузка «всё» (loadAllSessions) при одном битом ряду помечает облако непрочитанным, прочитанное показывает', async () => {
    // Дейли 2026-10-22: раньше битый ряд молча выпадал, cloudLoadFailed
    // ставился только при исключении — выгрузка была неполной без признака.
    // R-2: при этом прочитанные облачные заметки не пропадают из списка.
    await seedLocal([]);
    getUserDocuments.mockResolvedValue([GOOD_ROW, BAD_ROW]);

    const res = await loadAllSessions(USER, { uid: USER } as never);
    expect(res.cloudLoadFailed).toBe(true);
    expect(res.sessions.map(s => s.id), 'прочитанная облачная заметка показана').toContain(GOOD_CLOUD_ID);
  });

  // R-2: один битый ряд — прочитанные заметки скачиваются, requeue TB-14 по
  // «нет в списке» не происходит, результат помечен incomplete.
  // Мутация «requeue и при неполном списке» → красный (задача в очереди).
  it('downloadAllFromCloud при одном битом ряду качает прочитанное и не ставит requeue по отсутствию', async () => {
    const linkedToMissing = localDoc('doc_linked_missing', {
      uuid: 'uuid-linked-missing', linkedCloudId: 'cloud_missing_s110', localOnly: false, lastSyncedCloudVersion: 1,
    });
    await seedLocal([LINKED, linkedToMissing]);
    const newRow = cloudRow('cloud_new_s110', { uuid: 'uuid-cloud-new-s110' });
    getUserDocuments.mockResolvedValue([GOOD_ROW, newRow, BAD_ROW]);
    const addLocalCopy = vi.spyOn(CloudSyncService, 'addLocalCopy').mockResolvedValue('local_new');

    const res = await CloudSyncService.downloadAllFromCloud(USER);

    expect(res.incomplete).toBe(true);
    expect(addLocalCopy).toHaveBeenCalledWith(USER, 'cloud_new_s110', expect.objectContaining({ id: 'cloud_new_s110' }));
    expect(res.downloaded).toBe(1);
    const db = await getLocalDb(USER);
    expect(await db.count('syncQueue'), 'requeue по «нет в списке» не принят').toBe(0);

    getUserDocuments.mockResolvedValue([GOOD_ROW, newRow]);
    const full = await CloudSyncService.downloadAllFromCloud(USER);
    expect(full.incomplete).toBeUndefined();
    expect(await db.count('syncQueue'), 'по полному списку TB-14 ставит задачу').toBe(1);
    addLocalCopy.mockRestore();
  });

  // C2: суточная отметка заметок держится на `hasMore` — при неполном списке он
  // обязан быть true. Мутация `hasMore: false` → красный.
  it('restoreMissingDocuments: неполный список → hasMore, полный → нет', async () => {
    getUserDocuments.mockResolvedValue([GOOD_ROW, BAD_ROW]);
    expect((await CloudSyncService.restoreMissingDocuments(USER, { force: true })).hasMore).toBe(true);
    getUserDocuments.mockResolvedValue([GOOD_ROW]);
    expect((await CloudSyncService.restoreMissingDocuments(USER, { force: true })).hasMore).toBe(false);
  });

  // R-1. Мутация «откладывать всех с hasRelinkWork» → красный (Y и Z в skippedIds).
  it('перепривязка по неполному списку: совпавшие связывает, откладывает только uuid нечитаемого ряда', async () => {
    const orphanMatched = localDoc('doc_orphan_match', { uuid: ORPHAN_UUID });
    // Новые — со своим временем: заметка с тем же firstSessionAt, что у облачного
    // ряда, — кандидат сверки по времени (C1), а не «новая».
    const newY = localDoc('doc_new_y', { uuid: 'uuid-y-s110', firstSessionAt: Date.UTC(2026, 9, 20, 8, 1, 0) });
    const newZ = localDoc('doc_new_z', { uuid: 'uuid-z-s110', firstSessionAt: Date.UTC(2026, 9, 20, 8, 2, 0) });
    const sameAsBad = localDoc('doc_same_as_bad', { uuid: BAD_CLOUD_ID });
    await seedLocal([LINKED, orphanMatched, newY, newZ, sameAsBad]);
    getUserDocuments.mockResolvedValue([GOOD_ROW, cloudRow('cloud_orphan', { uuid: ORPHAN_UUID }), BAD_ROW]);

    const res = await CloudSyncService.relinkOrphanedDocuments(USER);

    expect(res.relinked).toBe(1);
    const db = await getLocalDb(USER);
    expect((await db.get('documents', 'doc_orphan_match'))?.linkedCloudId).toBe('cloud_orphan');
    // Только заметка с uuid нечитаемого ряда может оказаться его второй копией;
    // новые Y и Z с нечитаемым рядом совпасть не могут — уходят в облако.
    expect(res.skippedIds).toEqual(['doc_same_as_bad']);
  });

  // R-6: сверка по времени (firstSessionAt) по неполному списку не идёт — только по uuid.
  // Мутация «считать по времени и при uuidOnly» → красный.
  it('неполный список: совпадение по времени не связывает, по uuid — связывает; полный — связывает по времени', async () => {
    const byTime = localDoc('doc_by_time', { uuid: undefined, firstSessionAt: Date.UTC(2026, 9, 1, 9, 0, 0) });
    await seedLocal([LINKED, byTime]);
    const timeRow = cloudRow('cloud_by_time', { uuid: 'uuid-cloud-by-time', title: 'Моя заметка', firstSessionAt: '2026-10-01T09:00:00.000Z' });
    getUserDocuments.mockResolvedValue([GOOD_ROW, timeRow, BAD_ROW]);

    const partial = await CloudSyncService.relinkOrphanedDocuments(USER);
    expect(partial.relinked).toBe(0);
    // C1: не связана — но и не выгружается новой (её пара может быть нечитаемой).
    expect(partial.skippedIds).toContain('doc_by_time');
    const db = await getLocalDb(USER);
    expect((await db.get('documents', 'doc_by_time'))?.linkedCloudId).toBeUndefined();

    getUserDocuments.mockResolvedValue([GOOD_ROW, timeRow]);
    const complete = await CloudSyncService.relinkOrphanedDocuments(USER);
    expect(complete.relinked).toBe(1);
    expect((await db.get('documents', 'doc_by_time'))?.linkedCloudId).toBe('cloud_by_time');
  });

  // C1: пара старой несвязанной заметки — именно нечитаемый ряд, uuid другой.
  // Мутации: убрать каждое из условий (время нечитаемого, время прочитанного,
  // «слепой» ряд) → свой тест красный.
  it('C1: время совпало с нечитаемым рядом (uuid другой) → откладывается; новая без совпадений уходит', async () => {
    const twinOfBad = localDoc('doc_twin_of_bad', { uuid: undefined, firstSessionAt: Date.UTC(2026, 9, 2, 7, 0, 0) });
    const fresh = localDoc('doc_fresh', { uuid: 'uuid-fresh-s110', firstSessionAt: Date.UTC(2026, 9, 21, 7, 0, 0) });
    await seedLocal([LINKED, twinOfBad, fresh]);
    const badOld = cloudRow('cloud_bad_old', { uuid: 'uuid-bad-old', currentVersion: 'три', firstSessionAt: '2026-10-02T07:00:00.000Z' });
    getUserDocuments.mockResolvedValue([GOOD_ROW, badOld]);

    const res = await CloudSyncService.relinkOrphanedDocuments(USER);
    expect(res.skippedIds).toEqual(['doc_twin_of_bad']);
  });

  it('C1: нечитаемый ряд без uuid и без времени → откладываются все несвязанные', async () => {
    const fresh = localDoc('doc_fresh', { uuid: 'uuid-fresh-s110', firstSessionAt: Date.UTC(2026, 9, 21, 7, 0, 0) });
    await seedLocal([LINKED, fresh]);
    const blindRow = cloudRow('cloud_blind', { uuid: null, firstSessionAt: null });
    getUserDocuments.mockResolvedValue([GOOD_ROW, blindRow]);

    const res = await CloudSyncService.relinkOrphanedDocuments(USER);
    expect(res.skippedIds).toEqual(['doc_fresh']);
  });

  it('полный список: перепривязка ничего не откладывает', async () => {
    const orphanUnknown = localDoc('doc_orphan_unknown', { uuid: FOREIGN_UUID });
    await seedLocal([LINKED, orphanUnknown]);
    getUserDocuments.mockResolvedValue([GOOD_ROW]);

    const res = await CloudSyncService.relinkOrphanedDocuments(USER);
    expect(res.skippedIds).toEqual([]);
  });
});
