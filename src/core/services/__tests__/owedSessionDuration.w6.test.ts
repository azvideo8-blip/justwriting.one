import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { CloudSyncService } from '../CloudSyncService';
import { DocumentService } from '../DocumentService';
import { VersionService } from '../VersionService';
import { getLocalDb } from '../../storage/localDb';
import { setEncryptionEnabled, setProfileLoaded } from '../../crypto/cryptoHelpers';
import { TimeoutError } from '../../../shared/utils/withTimeout';
import { owedSessionDuration } from '../pendingDuration';
import { markStatsDeltaQueued } from '../pendingDelta';

// W-6 (ревью 0.9.31): онлайн-сохранение пишет ряд версии и только потом обновляет
// счётчики. Если второй вызов упал, задача встаёт в очередь, дренаж видит ряд уже
// в облаке, считает дельту по недосланным версиям — то есть в ноль — и секунды
// сессии теряются в облачной сумме навсегда. Хуже: следующий забор копирует
// облачный счётчик поверх локального, и у человека время на записи уменьшается.
//
// Упавший вызов оставляет долг (pendingDuration.ts), дренаж отправляет
// uploadedDuration + долг и списывает его только после успеха RPC.

const USER = 'user_w6_owed';
const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);

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

function verRow(documentId: string, version: number, duration: number, content: string) {
  return {
    id: `ver_${documentId}_${version}`,
    documentId,
    guestId: USER,
    version,
    content,
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
    id: 'cloud_w6',
    uuid: 'cloud_w6',
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

/** Облачный ряд версий: v1 лежит всегда, v2 — с тех пор, как его принял сервер. */
function cloudVersions(v2: boolean) {
  const rows: Array<Record<string, unknown>> = [{ version: 1, content: 'текст v1', duration: 100, wordCount: 5 }];
  if (v2) rows.push({ version: 2, content: 'новый текст', duration: 60, wordCount: 7 });
  return rows as never;
}

const countersError = new Error('SERVICE_UNAVAILABLE: counters');

/**
 * Заметка сразу после правки: локально сохранена версия v2 (60 с), в облаке —
 * только v1, и `lastSyncedCloudVersion` отстал. Именно в таком состоянии
 * заметку оставляет упавший вызов счётчиков, и именно её берёт дренаж.
 */
async function seedEditedDoc(db: Awaited<ReturnType<typeof getLocalDb>>, id: string, uuid: string) {
  await db.put('documents', docRow({
    id, uuid, linkedCloudId: 'cloud_w6',
    currentVersion: 2, totalWords: 7, totalDuration: 160, sessionsCount: 2, lastSyncedCloudVersion: 1,
  }) as never);
  await db.put('versions', verRow(id, 1, 100, 'текст v1') as never);
  await db.put('versions', verRow(id, 2, 60, 'новый текст') as never);
}

/** Онлайн-сохранение сессии, у которого вызов счётчиков упал. */
async function saveSessionWithFailedCounters(docId: string) {
  vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockResolvedValue(cloudRow(100, 1) as never);
  vi.spyOn(VersionService, 'getVersions').mockResolvedValue(cloudVersions(false));
  vi.spyOn(VersionService, 'addVersion').mockResolvedValue('cloud_ver');
  const after = vi.spyOn(DocumentService, 'updateDocumentAfterSession')
    .mockRejectedValueOnce(countersError)
    .mockResolvedValue(null);
  const res = await CloudSyncService.syncVersionToCloud(
    USER,
    docId,
    'cloud_w6',
    {
      title: 'Заметка',
      content: 'новый текст',
      wordCount: 7,
      documentWordCount: 7,
      duration: 60,
      documentDuration: 160,
      wpm: 30,
      sessionStartedAt: new Date(NOW),
      tags: [],
    },
    2,
    'текст v1',
  );
  return { after, res };
}

/** Облако приняло v2, счётчики по-прежнему 100: состояние перед дренажем. */
function mockCloudAfterVersionArrived() {
  vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockResolvedValue(cloudRow(100, 2) as never);
  vi.spyOn(VersionService, 'getVersions').mockResolvedValue(cloudVersions(true));
}

describe('W-6: секунды сессии с упавшим вызовом счётчиков не теряются', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    setProfileLoaded(USER, true);
    setEncryptionEnabled(USER, false);
    // S0-2: журнал долгов живёт на ключе учётки; сносить надо и его, и прежний
    // общий ключ, иначе долг перетекает между тестами.
    localStorage.removeItem('sync_pending_duration');
    localStorage.removeItem(`sync_pending_duration:${USER}`);
    const db = await getLocalDb(USER);
    for (const s of ['documents', 'versions', 'syncQueue'] as const) await db.clear(s);
    // S0-4: после принятой записи движок перечитывает живой облачный ряд.
    vi.spyOn(DocumentService, 'getDocument').mockResolvedValue({
      id: 'cloud_w6', uuid: 'cloud_w6', currentVersion: 2,
      updatedAt: new Date().toISOString(),
    } as never);
  });

  it('дренаж после упавшего вызова досылает долг: облако 100 → 160', async () => {
    const db = await getLocalDb(USER);
    await seedEditedDoc(db, 'w6a', 'u-w6a');

    const { after, res } = await saveSessionWithFailedCounters('w6a');
    expect(res.cloudSynced, 'сбой счётчиков не мог считаться сохранением').toBe(false);
    expect(after).toHaveBeenCalledTimes(1);
    const local = await db.get('documents', 'w6a');
    expect((local as { lastSyncedCloudVersion: number }).lastSyncedCloudVersion, 'заметка не встала бы в очередь дренажа').toBe(1);

    // Дренаж: ряд уже в облаке, недосланных версий нет — без долга дельта была бы 0.
    let cloudTotal = 100;
    mockCloudAfterVersionArrived();
    const drained = vi.spyOn(DocumentService, 'updateDocumentAfterSession')
      .mockImplementation(async (_u: string, _id: string, data: { durationDelta: number }) => {
        cloudTotal = Math.max(0, cloudTotal + data.durationDelta);
        return null;
      });
    drained.mockClear();

    await CloudSyncService.addCloudCopy(USER, 'w6a');

    expect(drained).toHaveBeenCalledTimes(1);
    expect(drained.mock.calls[0]![2]).toMatchObject({ durationDelta: 60 });
    expect(cloudTotal, 'облачная сумма не досчиталась сессии').toBe(160);
  });

  it('следующий забор не понижает локальную сумму после досылки долга', async () => {
    const db = await getLocalDb(USER);
    await seedEditedDoc(db, 'w6b', 'u-w6b');

    await saveSessionWithFailedCounters('w6b');

    let cloudTotal = 100;
    mockCloudAfterVersionArrived();
    vi.spyOn(DocumentService, 'updateDocumentAfterSession')
      .mockImplementation(async (_u: string, _id: string, data: { durationDelta: number }) => {
        cloudTotal = Math.max(0, cloudTotal + data.durationDelta);
        return null;
      });
    await CloudSyncService.addCloudCopy(USER, 'w6b');
    expect(cloudTotal).toBe(160);

    // Забор: облако донесло это же время — локальная сумма обязана остаться.
    vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([cloudRow(cloudTotal, 2)] as never);
    await CloudSyncService.reconcileLinkedDocuments(USER);

    const local = await db.get('documents', 'w6b');
    expect((local as { totalDuration: number }).totalDuration, 'забор урезал время на заметку').toBe(160);
  });

  it('два успешных дренажа подряд тратят долг один раз', async () => {
    const db = await getLocalDb(USER);
    await seedEditedDoc(db, 'w6c', 'u-w6c');

    const { after } = await saveSessionWithFailedCounters('w6c');
    mockCloudAfterVersionArrived();
    after.mockResolvedValue(null);
    after.mockClear();

    await CloudSyncService.addCloudCopy(USER, 'w6c');
    await CloudSyncService.addCloudCopy(USER, 'w6c');

    expect(after).toHaveBeenCalledTimes(2);
    expect(after.mock.calls[0]![2]).toMatchObject({ durationDelta: 60 });
    expect(after.mock.calls[1]![2], 'долг ушёл второй раз — время удвоено').toMatchObject({ durationDelta: 0 });
  });

  it('дренаж, у которого сам вызов счётчиков упал, оставляет долг', async () => {
    const db = await getLocalDb(USER);
    await seedEditedDoc(db, 'w6d', 'u-w6d');

    // Ряд v2 в облаке нет: первый дренаж зальёт его (uploadedDuration = 60), и
    // на нём же упадёт вызов счётчиков.
    vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockResolvedValue(cloudRow(100, 1) as never);
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue(cloudVersions(false));
    vi.spyOn(VersionService, 'addVersion').mockResolvedValue('cloud_ver');
    const after = vi.spyOn(DocumentService, 'updateDocumentAfterSession')
      .mockRejectedValueOnce(countersError)
      .mockResolvedValue(null);

    await expect(CloudSyncService.addCloudCopy(USER, 'w6d')).rejects.toThrow();
    expect(after.mock.calls[0]![2]).toMatchObject({ durationDelta: 60 });

    // Второй дренаж: v2 уже в облаке, своей дельты нет — обязана уйти 60 из долга.
    mockCloudAfterVersionArrived();
    await CloudSyncService.addCloudCopy(USER, 'w6d');

    expect(after).toHaveBeenCalledTimes(2);
    expect(after.mock.calls[1]![2]).toMatchObject({ durationDelta: 60 });
  });
});

describe('W-6, ревью 0.9.31: ни двойного счёта, ни потерянных секунд', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    setProfileLoaded(USER, true);
    setEncryptionEnabled(USER, false);
    // S0-2: журнал долгов живёт на ключе учётки; сносить надо и его, и прежний
    // общий ключ, иначе долг перетекает между тестами.
    localStorage.removeItem('sync_pending_duration');
    localStorage.removeItem(`sync_pending_duration:${USER}`);
    const db = await getLocalDb(USER);
    for (const s of ['documents', 'versions', 'syncQueue'] as const) await db.clear(s);
    // S0-4: после принятой записи движок перечитывает живой облачный ряд.
    vi.spyOn(DocumentService, 'getDocument').mockResolvedValue({
      id: 'cloud_w6', uuid: 'cloud_w6', currentVersion: 2,
      updatedAt: new Date().toISOString(),
    } as never);
  });

  it('таймаут вызова счётчиков — «не дождались», а не «не легло»: без двойного счёта', async () => {
    const db = await getLocalDb(USER);
    await seedEditedDoc(db, 'p1', 'u-p1');
    let cloudTotal = 100;
    vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockResolvedValue(cloudRow(100, 1) as never);
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue(cloudVersions(false));
    vi.spyOn(VersionService, 'addVersion').mockResolvedValue('cloud_ver');
    vi.spyOn(DocumentService, 'updateDocumentAfterSession')
      .mockImplementationOnce(async (_u: string, _id: string, d: { durationDelta: number }) => { cloudTotal += d.durationDelta; throw new TimeoutError('Sync timeout'); })
      .mockImplementation(async (_u: string, _id: string, d: { durationDelta: number }) => { cloudTotal += d.durationDelta; return null; });
    await expect(CloudSyncService.addCloudCopy(USER, 'p1')).rejects.toThrow();
    mockCloudAfterVersionArrived();
    await CloudSyncService.addCloudCopy(USER, 'p1');
    expect(cloudTotal).toBe(160);
  });

  // S2-7: на новом пути прибавка уже в журнале pendingDelta с ключом повтора.
  // Ошибка с этой пометкой гасит долг, а не кладёт секунды второй раз — иначе
  // повтор журнала и долг унесли бы их дважды. Мутация: убрать isStatsDeltaQueued
  // из settleOrOweAfterFailure или из syncVersionToCloud → красный.
  it('S2-7: прибавка уже в журнале — долг не кладётся второй раз (оба входа)', async () => {
    const db = await getLocalDb(USER);
    await seedEditedDoc(db, 'q1', 'u-q1');
    const queued = new Error('Failed to fetch');
    markStatsDeltaQueued(queued);
    vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockResolvedValue(cloudRow(100, 1) as never);
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue(cloudVersions(false));
    vi.spyOn(VersionService, 'addVersion').mockResolvedValue('cloud_ver');
    vi.spyOn(DocumentService, 'updateDocumentAfterSession').mockRejectedValue(queued);
    await expect(CloudSyncService.addCloudCopy(USER, 'q1')).rejects.toBe(queued);
    expect(owedSessionDuration(USER, 'q1')).toBe(0);

    await CloudSyncService.syncVersionToCloud(USER, 'q1', 'cloud_w6', {
      title: 'Заметка', content: 'новый текст', wordCount: 7, documentWordCount: 7,
      duration: 60, documentDuration: 160, wpm: 30, sessionStartedAt: new Date(NOW), tags: [],
    }, 2, 'текст v1').catch(() => undefined);
    expect(owedSessionDuration(USER, 'q1')).toBe(0);
  });

  it('версии ушли, правка метаданных упала: их секунды висят долгом', async () => {
    const db = await getLocalDb(USER);
    await seedEditedDoc(db, 'p2', 'u-p2');
    const d = await db.get('documents', 'p2');
    await db.put('documents', { ...(d as object), metadataDirty: true } as never);
    let cloudTotal = 100;
    vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockResolvedValue(cloudRow(100, 1) as never);
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue(cloudVersions(false));
    vi.spyOn(VersionService, 'addVersion').mockResolvedValue('cloud_ver');
    vi.spyOn(DocumentService, 'updateMetadata').mockRejectedValueOnce(new Error('503')).mockResolvedValue(undefined as never);
    vi.spyOn(DocumentService, 'updateDocumentAfterSession')
      .mockImplementation(async (_u: string, _id: string, dd: { durationDelta: number }) => { cloudTotal += dd.durationDelta; return null; });
    await expect(CloudSyncService.addCloudCopy(USER, 'p2')).rejects.toThrow();
    mockCloudAfterVersionArrived();
    await CloudSyncService.addCloudCopy(USER, 'p2');
    expect(cloudTotal).toBe(160);
  });

  it('долг и создание облачного ряда заново: долг уже внутри суммы, вторая дельта не идёт', async () => {
    const db = await getLocalDb(USER);
    await seedEditedDoc(db, 'p3', 'u-p3');
    await saveSessionWithFailedCounters('p3');
    let cloudTotal = 0;
    vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockResolvedValue(null as never);
    vi.spyOn(DocumentService, 'createDocument').mockImplementation(async (_u: string, p: { totalDuration?: number | undefined }) => { cloudTotal = p.totalDuration ?? 0; return 'cloud_new'; });
    vi.spyOn(VersionService, 'addVersion').mockResolvedValue('cloud_ver');
    vi.spyOn(DocumentService, 'updateDocumentAfterSession')
      .mockImplementation(async (_u: string, _id: string, dd: { durationDelta: number }) => { cloudTotal += dd.durationDelta; return null; });
    await CloudSyncService.addCloudCopy(USER, 'p3');
    expect(cloudTotal).toBe(160);
  });

  it('v2 ушла, v3 упала посреди цикла: секунды v2 не теряются', async () => {
    const db = await getLocalDb(USER);
    await seedEditedDoc(db, 'p4', 'u-p4');
    const d = await db.get('documents', 'p4');
    await db.put('documents', { ...(d as object), currentVersion: 3, totalDuration: 200 } as never);
    await db.put('versions', verRow('p4', 3, 40, 'ещё текст') as never);
    let cloudTotal = 100;
    vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockResolvedValue(cloudRow(100, 1) as never);
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue(cloudVersions(false));
    vi.spyOn(VersionService, 'addVersion').mockResolvedValueOnce('v2').mockRejectedValueOnce(new Error('503')).mockResolvedValue('ok');
    vi.spyOn(DocumentService, 'updateDocumentAfterSession')
      .mockImplementation(async (_u: string, _id: string, dd: { durationDelta: number }) => { cloudTotal += dd.durationDelta; return null; });
    await expect(CloudSyncService.addCloudCopy(USER, 'p4')).rejects.toThrow();
    vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockResolvedValue(cloudRow(100, 2) as never);
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue(cloudVersions(true));
    await CloudSyncService.addCloudCopy(USER, 'p4');
    expect(cloudTotal).toBe(200);
  });
});
