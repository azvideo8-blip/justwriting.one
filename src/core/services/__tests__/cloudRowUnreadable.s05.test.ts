import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { DocumentService } from '../DocumentService';
import { CloudSyncService } from '../CloudSyncService';
import { getLocalDb, resetDbInstance } from '../../storage/localDb';
import { setProfileLoaded, setEncryptionEnabled } from '../../crypto/cryptoHelpers';

// S0-5 (класс A, Fable §1.1): «облачная заметка не разобралась» читается как
// «заметки нет».
//
// `DocumentService.getDocument` / `getDocumentWithDeleted` возвращают `null` и
// когда строки нет, и когда строка ЕСТЬ, но не проходит `documentDbSchema`
// (`:82-85`, `:116-119`) — и то же самое в списке (`:151`). Единственный
// разрушительный читатель — `addCloudCopy`: `null` означает «облачного ряда нет»
// → снятие ссылки → ветка СОЗДАНИЯ документа (`CloudSyncService:841-844 → 1157`).
// Итог: разбор схемы у одного поля превращает заметку в две облачные копии, а
// старая остаётся сиротой. Третье устройство видит дубль.
//
// Правка: провал разбора — ошибка (бросаем), `null` — только «строки нет».
// Вызывающий различает «нет» и «не разобралось» и во втором случае НЕ создаёт
// второй ряд: проход падает, задача остаётся в очереди, данные целы.

const USER = 'user_s05_unreadable';
const LOCAL_ID = 'doc_s05';
const CLOUD_ID = 'cloud_s05';

/** Ряд, который есть, но не проходит схему: `current_version` строкой. */
const BAD_ROW = {
  id: CLOUD_ID,
  uuid: CLOUD_ID,
  user_id: USER,
  title: 'Облачная заметка',
  current_version: 'три',
  total_words: 5,
  sessions_count: 1,
  created_at: '2026-10-17T12:00:00.000Z',
  updated_at: '2026-10-17T12:00:00.000Z',
};

const getDocument = vi.fn();
const getDocumentWithDeleted = vi.fn();
const createDocument = vi.fn();

vi.mock('../../data', () => ({
  DataProvider: {
    getDocument: (...args: unknown[]) => getDocument(...args),
    getDocumentWithDeleted: (...args: unknown[]) => getDocumentWithDeleted(...args),
    createDocument: (...args: unknown[]) => createDocument(...args),
    getUserDocuments: async () => [],
    updateDocument: async () => {},
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

describe('S0-5: нечитаемая облачная строка не притворяется отсутствующей', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetDbInstance();
    setProfileLoaded(USER, true);
    setEncryptionEnabled(USER, false);
    getDocument.mockResolvedValue(BAD_ROW);
    getDocumentWithDeleted.mockResolvedValue(BAD_ROW);
    createDocument.mockResolvedValue('cloud_NEW');

    const db = await getLocalDb(USER);
    await db.clear('documents');
    await db.clear('versions');
    await db.clear('syncQueue');
    await db.put('documents', {
      id: LOCAL_ID,
      uuid: 'uuid-local-s05',
      guestId: USER,
      title: 'Моя заметка',
      currentVersion: 1,
      totalWords: 5,
      totalDuration: 10,
      sessionsCount: 1,
      firstSessionAt: Date.UTC(2026, 9, 17, 12, 0, 0),
      lastSessionAt: Date.UTC(2026, 9, 17, 12, 0, 0),
      tags: [],
      linkedCloudId: CLOUD_ID,
      localOnly: false,
      metadataDirty: false,
    } as never);
  });

  it('ряд есть, но не разбирается — getDocument обязан бросить, а не вернуть null', async () => {
    await expect(DocumentService.getDocument(USER, CLOUD_ID)).rejects.toThrow();
  });

  it('то же для getDocumentWithDeleted: надгробие и «не разобрано» — разные ответы', async () => {
    await expect(DocumentService.getDocumentWithDeleted(USER, CLOUD_ID)).rejects.toThrow();
  });

  it('строчки нет вовсе — по-прежнему null, а не ошибка', async () => {
    getDocument.mockResolvedValue(null);
    getDocumentWithDeleted.mockResolvedValue(null);
    await expect(DocumentService.getDocument(USER, CLOUD_ID)).resolves.toBeNull();
    await expect(DocumentService.getDocumentWithDeleted(USER, CLOUD_ID)).resolves.toBeNull();
  });

  it('addCloudCopy на нечитаемом облачном ряде НЕ создаёт второй документ', async () => {
    await expect(CloudSyncService.addCloudCopy(USER, LOCAL_ID)).rejects.toThrow();

    expect(createDocument, 'второй облачный ряд — это дубль заметки').not.toHaveBeenCalled();

    const db = await getLocalDb(USER);
    const local = await db.get('documents', LOCAL_ID) as unknown as Record<string, unknown>;
    expect(local.linkedCloudId, 'ссылка на прежний ряд сохранена, а не сбросана').toBe(CLOUD_ID);
  });
});
