import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { CloudSyncService } from '../CloudSyncService';
import { DocumentService } from '../DocumentService';
import { VersionService } from '../VersionService';
import { getLocalDb } from '../../storage/localDb';
import { setEncryptionEnabled, setProfileLoaded } from '../../crypto/cryptoHelpers';

// W-2 (ревью 0.9.31): сессия, сохранённая офлайн, приезжает в облако дренажом
// очереди, а дренаж для заметки, у которой облачный ряд уже есть, поднимал только
// метаданные с durationDelta: 0. В total_duration облака такое время не появлялось
// никогда; следующий забор копировал облачный счётчик поверх локального, и суммы
// потраченного на записи времени УМЕНЬШАЛИСЬ у самого человека.
//
// Дельта = сумма длительностей версий, уехавших в облако этим прогоном. Версии,
// которые в облаке уже лежат, не входят: их приращение ушла та выгрузка, которая
// их принесла (повтор не должен удваивать).

const USER = 'user_w2_duration';
const NOW = Date.UTC(2026, 9, 5, 12, 0, 0);

vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: USER, email: 'u@example.com' }),
  getCurrentUserId: () => USER,
}));
vi.mock('../../sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

type DocSeed = {
  id: string;
  uuid: string;
  linkedCloudId: string;
  currentVersion: number;
  totalWords: number;
  totalDuration: number;
  sessionsCount: number;
  lastSyncedCloudVersion?: number;
};

function docRow(seed: DocSeed) {
  return {
    id: seed.id,
    uuid: seed.uuid,
    guestId: USER,
    title: 'Заметка',
    tags: [],
    currentVersion: seed.currentVersion,
    totalWords: seed.totalWords,
    totalDuration: seed.totalDuration,
    sessionsCount: seed.sessionsCount,
    firstSessionAt: NOW,
    lastSessionAt: NOW,
    linkedCloudId: seed.linkedCloudId,
    localOnly: false,
    metadataDirty: false,
    ...(seed.lastSyncedCloudVersion !== undefined ? { lastSyncedCloudVersion: seed.lastSyncedCloudVersion } : {}),
  };
}

function verRow(documentId: string, version: number, duration: number) {
  return {
    id: `ver_${documentId}_${version}`,
    documentId,
    guestId: USER,
    version,
    content: `текст v${version}`,
    wordCount: 5,
    wordsAdded: 5,
    charsAdded: 8,
    duration,
    wpm: 30,
    savedAt: new Date(NOW).toISOString(),
    sessionStartedAt: new Date(NOW).toISOString(),
  };
}

function cloudRow(totalDuration: number, currentVersion = 1) {
  return {
    id: 'cloud_1',
    uuid: 'cloud_1',
    title: 'Заметка',
    tags: [],
    currentVersion,
    totalWords: 5,
    totalDuration,
    sessionsCount: 1,
    firstSessionAt: new Date(NOW).toISOString(),
    lastSessionAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW + 10_000).toISOString(),
  };
}

const dup23505 = Object.assign(new Error('duplicate key value violates unique constraint "documents_uuid_key"'), { code: '23505' });

describe('W-2: длительность офлайн-сессии доезжает до облака', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    setProfileLoaded(USER, true);
    setEncryptionEnabled(USER, false);
    const db = await getLocalDb(USER);
    for (const s of ['documents', 'versions', 'syncQueue'] as const) await db.clear(s);
  });

  it('заметка уже в облаке: дельта = длительность досланных версий', async () => {
    const db = await getLocalDb(USER);
    await db.put('documents', docRow({
      id: 'd1', uuid: 'u1', linkedCloudId: 'cloud_1',
      currentVersion: 1, totalWords: 5, totalDuration: 100, sessionsCount: 1, lastSyncedCloudVersion: 0,
    }) as never);
    await db.put('versions', verRow('d1', 1, 100) as never);

    vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockResolvedValue(cloudRow(0, 0) as never);
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([]);
    vi.spyOn(VersionService, 'addVersion').mockResolvedValue('cloud_ver');
    const after = vi.spyOn(DocumentService, 'updateDocumentAfterSession').mockResolvedValue(undefined);

    await CloudSyncService.addCloudCopy(USER, 'd1');

    expect(after).toHaveBeenCalledTimes(1);
    expect(after.mock.calls[0]![2]).toMatchObject({ durationDelta: 100 });
  });

  it('ряд принят по uuid (23505): дельта = только те версии, которых в облаке не было', async () => {
    const db = await getLocalDb(USER);
    await db.put('documents', docRow({
      id: 'd2', uuid: 'u2', linkedCloudId: '',
      currentVersion: 2, totalWords: 5, totalDuration: 150, sessionsCount: 2,
    }) as never);
    await db.put('versions', verRow('d2', 1, 100) as never);
    await db.put('versions', verRow('d2', 2, 50) as never);

    vi.spyOn(DocumentService, 'createDocument').mockRejectedValue(dup23505);
    vi.spyOn(DocumentService, 'findByUuid').mockResolvedValue(cloudRow(100) as never);
    vi.spyOn(VersionService, 'addVersion').mockResolvedValue('cloud_ver');
    // Облако держит v1 — её 100 уже сложены в total_duration прежней выгрузкой.
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([{ version: 1, content: 'текст v1' }] as never);
    const after = vi.spyOn(DocumentService, 'updateDocumentAfterSession').mockResolvedValue(undefined);

    await CloudSyncService.addCloudCopy(USER, 'd2');

    expect(after).toHaveBeenCalledTimes(1);
    expect(after.mock.calls[0]![2]).toMatchObject({ durationDelta: 50 });
  });

  it('отрицательный контроль: ряд, созданный ЭТОЙ выгрузкой, дельты не получает', async () => {
    // createDocument уносит накопленные счётчики локальной копии в сам ряд
    // (V-5), поэтому любая дельта поверх удвоила бы время первой синхронизации.
    const db = await getLocalDb(USER);
    await db.put('documents', docRow({
      id: 'd3', uuid: 'u3', linkedCloudId: '',
      currentVersion: 1, totalWords: 5, totalDuration: 100, sessionsCount: 1,
    }) as never);
    await db.put('versions', verRow('d3', 1, 100) as never);

    vi.spyOn(DocumentService, 'createDocument').mockResolvedValue('cloud_1');
    vi.spyOn(VersionService, 'addVersion').mockResolvedValue('cloud_ver');
    const after = vi.spyOn(DocumentService, 'updateDocumentAfterSession').mockResolvedValue(undefined);

    await CloudSyncService.addCloudCopy(USER, 'd3');

    expect(after).toHaveBeenCalledTimes(1);
    expect(after.mock.calls[0]![2]).toMatchObject({ durationDelta: 0 });
  });

  it('после дренажа локальная сумма не падает при следующем заборе', async () => {
    // Собираем обе половины вместе: сервер складывает total_duration по дельте
    // (формула 0039), а забор копирует облачный счётчик в локальную копию.
    const db = await getLocalDb(USER);
    await db.put('documents', docRow({
      id: 'd4', uuid: 'u4', linkedCloudId: 'cloud_1',
      currentVersion: 1, totalWords: 5, totalDuration: 100, sessionsCount: 1, lastSyncedCloudVersion: 0,
    }) as never);
    await db.put('versions', verRow('d4', 1, 100) as never);
    // Задача в очереди: ровно то состояние, которое остаётся после офлайн-сохранения.
    await db.put('syncQueue', { id: 'sync_d4', documentId: 'd4', type: 'document', ownerId: USER } as never);

    let cloudTotal = 0;
    vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockResolvedValue(cloudRow(0, 0) as never);
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([]);
    vi.spyOn(VersionService, 'addVersion').mockResolvedValue('cloud_ver');
    const after = vi.spyOn(DocumentService, 'updateDocumentAfterSession')
      .mockImplementation(async (_u: string, _id: string, data: { durationDelta: number }) => {
        // Формула сервера: greatest(0, total_duration + delta).
        cloudTotal = Math.max(0, cloudTotal + data.durationDelta);
      });

    await CloudSyncService.addCloudCopy(USER, 'd4');
    expect(after).toHaveBeenCalledTimes(1);
    expect(cloudTotal).toBe(100);

    // Забор: облако новее, очередь занята — счётчики перезаписываются облачными.
    vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([cloudRow(cloudTotal)] as never);
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([{ version: 1, content: 'текст v1', duration: 100, wordCount: 5 }] as never);

    await CloudSyncService.reconcileLinkedDocuments(USER);

    const local = await db.get('documents', 'd4');
    expect((local as { totalDuration: number }).totalDuration, 'облако должно нести это время, а не обнулять его').toBe(100);
  });

  it('syncVersionToCloud шлёт длительность сессии, а не абсолют документа', async () => {
    // M-проверка пути обычного онлайнового сохранения: подмена дельты абсолютным
    // documentDuration (как было до V-5) краснит этот кейс.
    const db = await getLocalDb(USER);
    await db.put('documents', docRow({
      id: 'd5', uuid: 'u5', linkedCloudId: 'cloud_1',
      currentVersion: 1, totalWords: 5, totalDuration: 300, sessionsCount: 1, lastSyncedCloudVersion: 1,
    }) as never);

    vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockResolvedValue(cloudRow(300) as never);
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([{ version: 1, content: 'текст v1' }] as never);
    vi.spyOn(VersionService, 'addVersion').mockResolvedValue('cloud_ver');
    const after = vi.spyOn(DocumentService, 'updateDocumentAfterSession').mockResolvedValue(undefined);

    await CloudSyncService.syncVersionToCloud(
      USER,
      'd5',
      'cloud_1',
      {
        title: 'Заметка',
        content: 'новый текст',
        wordCount: 7,
        documentWordCount: 7,
        // Сессия длилась 60, а вся заметка — 300. В облако обязано уйти 60.
        duration: 60,
        documentDuration: 300,
        wpm: 30,
        sessionStartedAt: new Date(NOW),
        tags: [],
      },
      2,
      'текст v1',
    );

    expect(after).toHaveBeenCalledTimes(1);
    expect(after.mock.calls[0]![2]).toMatchObject({ durationDelta: 60 });
  });
});
