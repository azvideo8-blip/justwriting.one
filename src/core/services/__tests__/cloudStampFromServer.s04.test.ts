import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { CloudSyncService } from '../CloudSyncService';
import { DocumentService } from '../DocumentService';
import { getLocalDb } from '../../storage/localDb';
import { setProfileLoaded, setEncryptionEnabled } from '../../crypto/cryptoHelpers';

// S0-4 (Fable §1.1): отметку «до какой облачной версии этот ряд выгружен»
// (`lastSeenCloudUpdatedAt`) после выгрузки ставили ЧАСЫ УСТРОЙСТВА
// (`CloudSyncService:1033`, `:1271` — `new Date().toISOString()`), а сверка
// изменений (`:274`) сравнивает её с серверным `updated_at`. Устройство, чьи
// часы спешат, объявляло облако устаревшим ровно на величину расхождения: чужая
// правка заметки не приезжала, пока часы не поправят.
//
// Правка: метку берём с сервера — перечитываем облачный ряд после принятия
// записи. Не прочитали — прежнюю метку НЕ отравляем часовым значением: «не знаю»
// для `:274` читается как «суди по номеру версии», а «сутки вперёд» — как
// «облако устарело» навсегда.

// Фабрики vi.mock поднимаются выше объявления констант — значения дают
// vi.hoisted, иначе mocking падает с «Cannot access ... before initialization».
const { USER, LOCAL_ID, CLOUD_ID, DAY, SERVER_NOW, SERVER_ISO, DEVICE_ISO } = vi.hoisted(() => {
  const USER = 'user_s04_clock';
  const SERVER_NOW = Date.UTC(2026, 9, 17, 12, 0, 0);
  const DAY = 86_400_000;
  return {
    USER,
    LOCAL_ID: 'doc_s04',
    CLOUD_ID: 'cloud_s04',
    DAY,
    SERVER_NOW,
    // Серверная метка облачного ряда: она и обязана лечь в локальный.
    SERVER_ISO: new Date(SERVER_NOW).toISOString(),
    // Часы устройства спешат на сутки.
    DEVICE_ISO: new Date(SERVER_NOW + DAY).toISOString(),
  };
});

vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: USER }),
  getCurrentUserId: () => USER,
}));

vi.mock('../DocumentService', () => ({
  DocumentService: {
    // Живой ряд — источник серверной метки для markCloudSeen (S0-4).
    getDocument: vi.fn().mockResolvedValue({
      id: CLOUD_ID, uuid: 'uuid-s04', title: 'Заметка', currentVersion: 1,
      totalWords: 3, totalDuration: 10, sessionsCount: 1,
      createdAt: SERVER_ISO, updatedAt: SERVER_ISO,
    }),
    getDocumentWithDeleted: vi.fn().mockResolvedValue({
      id: CLOUD_ID, uuid: 'uuid-s04', title: 'Заметка', currentVersion: 1,
      totalWords: 3, totalDuration: 10, sessionsCount: 1,
      createdAt: SERVER_ISO, updatedAt: SERVER_ISO, deletedAt: null,
    }),
    findByUuid: vi.fn().mockResolvedValue(null),
    createDocument: vi.fn().mockResolvedValue(CLOUD_ID),
    updateDocumentAfterSession: vi.fn().mockResolvedValue(undefined),
    updateMetadata: vi.fn().mockResolvedValue(undefined),
    restoreDocument: vi.fn().mockResolvedValue(undefined),
    getUserDocuments: vi.fn().mockResolvedValue([]),
    deleteDocument: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../VersionService', () => ({
  VersionService: {
    getVersions: vi.fn().mockResolvedValue([]),
    addVersion: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

async function seedLocalDoc(extra: Record<string, unknown> = {}): Promise<void> {
  const db = await getLocalDb(USER);
  await db.put('documents', {
    id: LOCAL_ID,
    uuid: 'uuid-s04',
    guestId: USER,
    title: 'Заметка',
    currentVersion: 1,
    totalWords: 3,
    totalDuration: 10,
    sessionsCount: 1,
    firstSessionAt: SERVER_NOW - DAY,
    lastSessionAt: SERVER_NOW - DAY,
    tags: [],
    linkedCloudId: '',
    ...extra,
  } as never);
  await db.put('versions', {
    id: 'ver_s04_1',
    documentId: LOCAL_ID,
    guestId: USER,
    version: 1,
    content: 'Первый текст',
    wordCount: 2,
    wordsAdded: 2,
    charsAdded: 12,
    duration: 10,
    wpm: 12,
    savedAt: SERVER_NOW - DAY,
    sessionStartedAt: SERVER_NOW - DAY,
  } as never);
}

async function readLocalDoc() {
  const db = await getLocalDb(USER);
  return await db.get('documents', LOCAL_ID) as unknown as Record<string, unknown>;
}

describe('S0-4: метка облачной версии после выгрузки — с сервера', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // only Date: fake-indexeddb живёт на setImmediate, их трогать нельзя.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(SERVER_NOW + DAY);
    setProfileLoaded(USER, true);
    setEncryptionEnabled(USER, false);
    const db = await getLocalDb(USER);
    await db.clear('documents');
    await db.clear('versions');
    await db.clear('syncQueue');
    await seedLocalDoc();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('часы устройства спешат на сутки — в локальный ряд ложится серверная метка', async () => {
    const cloudId = await CloudSyncService.addCloudCopy(USER, LOCAL_ID);
    expect(cloudId).toBe(CLOUD_ID);

    const local = await readLocalDoc();
    expect(local.lastSeenCloudUpdatedAt, 'метка взята из ответа сервера')
      .toBe(SERVER_ISO);
    expect(local.lastSeenCloudUpdatedAt, 'часы устройства в неё не попали')
      .not.toBe(DEVICE_ISO);
  });

  it('серверную метку прочесть не удалось — прежняя остаётся, часы не пишутся', async () => {
    await seedLocalDoc({ linkedCloudId: CLOUD_ID, lastSeenCloudUpdatedAt: new Date(SERVER_NOW - 2 * DAY).toISOString() });
    vi.mocked(DocumentService.getDocument).mockResolvedValue({
      id: CLOUD_ID, uuid: 'uuid-s04', currentVersion: 1, updatedAt: null, createdAt: null,
    } as never);
    vi.mocked(DocumentService.getDocumentWithDeleted).mockResolvedValue({
      id: CLOUD_ID, uuid: 'uuid-s04', currentVersion: 1, updatedAt: null, createdAt: null, deletedAt: null,
    } as never);

    await CloudSyncService.addCloudCopy(USER, LOCAL_ID);

    const local = await readLocalDoc();
    expect(local.lastSeenCloudUpdatedAt, '«не знаю» не превращается в «сутки вперёд»')
      .toBe(new Date(SERVER_NOW - 2 * DAY).toISOString());
  });

  // SF-7: метку брали из перечитывания ряда ПОСЛЕ записи. В этом окне другое
  // устройство успевает написать своё — и его `updated_at` принимается за наш:
  // локальный ряд объявляет, что видел версию, которой не видел, и сверка
  // изменений (`:274`) больше не зовёт чужую правку. Правка: метка берётся из
  // ответа СОБСТВЕННОЙ записи, перечитывание остаётся запасным путём.
  it('SF-7: отметка берётся из ответа собственной записи, чужая правка в окне её не сдвигает', async () => {
    const ourWriteMs = SERVER_NOW + 1000;
    await seedLocalDoc({ linkedCloudId: CLOUD_ID, lastSeenCloudUpdatedAt: new Date(SERVER_NOW - DAY).toISOString() });
    // Часы прибора спешат на сутки — в окне перечитывания рядом с нашей
    // записью становится версия с ОТМЕТКОЙ ЭТИХ ЖЕ ЧАСОВ. Раз записями ряда
    // владеет сервер (0028), такой метки у облака быть не может, и правка SF-7
    // обязана оставить в локальном ряду отметку собственного ответа.
    // currentVersion облака = локальному, иначе ветка счётчиков не пишется.
    vi.mocked(DocumentService.updateDocumentAfterSession).mockResolvedValue(ourWriteMs as never);
    vi.mocked(DocumentService.getDocument).mockResolvedValue({
      id: CLOUD_ID, uuid: 'uuid-s04', currentVersion: 1, updatedAt: DEVICE_ISO, createdAt: SERVER_ISO,
    } as never);
    vi.mocked(DocumentService.getDocumentWithDeleted).mockResolvedValue({
      id: CLOUD_ID, uuid: 'uuid-s04', currentVersion: 1, updatedAt: DEVICE_ISO, createdAt: SERVER_ISO, deletedAt: null,
    } as never);

    await CloudSyncService.addCloudCopy(USER, LOCAL_ID);

    const local = await readLocalDoc();
    expect(local.lastSeenCloudUpdatedAt, 'отметка — та версия, которую приняло наше обновление')
      .toBe(new Date(ourWriteMs).toISOString());
    expect(local.lastSeenCloudUpdatedAt, 'отметка из окна перечитывания не стала нашей')
      .not.toBe(DEVICE_ISO);
  });

  it('контроль SF-7: своей метки нет — прежний путь, перечитывание ряда', async () => {
    await seedLocalDoc({ linkedCloudId: CLOUD_ID, lastSeenCloudUpdatedAt: new Date(SERVER_NOW - DAY).toISOString() });
    // `clearAllMocks` не сбрасывает mockResolvedValue: ряд этого теста задаём сам.
    vi.mocked(DocumentService.updateDocumentAfterSession).mockResolvedValue(null as never);
    vi.mocked(DocumentService.getDocument).mockResolvedValue({
      id: CLOUD_ID, uuid: 'uuid-s04', currentVersion: 1, updatedAt: SERVER_ISO, createdAt: SERVER_ISO,
    } as never);
    vi.mocked(DocumentService.getDocumentWithDeleted).mockResolvedValue({
      id: CLOUD_ID, uuid: 'uuid-s04', currentVersion: 1, updatedAt: SERVER_ISO, createdAt: SERVER_ISO, deletedAt: null,
    } as never);

    await CloudSyncService.addCloudCopy(USER, LOCAL_ID);

    const local = await readLocalDoc();
    expect(local.lastSeenCloudUpdatedAt, 'запасной путь не потерян')
      .toBe(SERVER_ISO);
  });
});
