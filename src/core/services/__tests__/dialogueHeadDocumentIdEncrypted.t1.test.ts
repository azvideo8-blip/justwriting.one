import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance } from '../../storage/localDb';
import type { AIDialogue } from '../../storage/localDb';
import { LocalStoreSyncService } from '../LocalStoreSyncService';
import { LocalDocumentService } from '../LocalDocumentService';
import { restoreAIDataFromCloud } from '../../../features/ai/services/AIRestoreService';
import { setEncryptionEnabled, setProfileLoaded } from '../../crypto/cryptoHelpers';
import { setSessionKey, clearSessionKey } from '../../crypto/encrypt';

// T-1 (R-7): шифрование note id (documentId) в head-строке диалога.
// В 0.9.29 весь диалог (documentId в том числе) лежал внутри зашифрованного data.
// В сегментном формате head обязан шифровать documentId так же, как title,
// чтобы связь разговора с заметкой дневника не утекала на сервер открытым текстом.

const UID = 'u_t1_enc';

type Row = { store: string; key: string; payload: Record<string, unknown> };
const cloud = new Map<string, Row>();
const rowKey = (store: string, key: string) => `${store}:${key}`;

vi.mock('../../data', () => ({
  DataProvider: {
    getLocalStoreRecordsByKeyPrefix: async (_uid: string, store: string, prefix: string) =>
      [...cloud.values()].filter(r => r.store === store && r.key.startsWith(prefix)),
    deleteLocalStoreRecordsByKeys: async (_uid: string, store: string, keys: string[]) => {
      for (const k of keys) cloud.delete(rowKey(store, k));
    },
    getUserSummaries: async () => [],
    getUserEmbeddingsPaginated: async () => ({ items: [], nextCursorId: null, readCount: 0 }),
    getLocalStoreRecords: async (_uid: string, store?: string, since?: number) =>
      [...cloud.values()].filter(r => (!store || r.store === store) && (since === undefined || Number(r.payload.updatedAt) > since)),
    getLocalStoreRecord: async (_uid: string, store: string, key: string) => {
      const r = cloud.get(rowKey(store, key));
      return r ? { store, key, payload: r.payload } : null;
    },
    getLocalStoreRecordPages: async (_uid: string, store: string, key: string) =>
      [...cloud.values()].filter(r => r.store === store && r.key.startsWith(`${key}#`)),
    saveLocalStoreRecord: async (_uid: string, store: string, key: string, payload: Record<string, unknown>) => {
      cloud.set(rowKey(store, key), { store, key, payload });
    },
    saveLocalStoreRecordPages: async (_uid: string, store: string, pages: Array<{ key: string; payload: Record<string, unknown> }>) => {
      for (const p of pages) cloud.set(rowKey(store, p.key), { store, key: p.key, payload: p.payload });
    },
    saveLocalStoreRecordIfUnchanged: async (_uid: string, store: string, key: string, payload: Record<string, unknown>, expected: number | null) => {
      const cur = cloud.get(rowKey(store, key));
      if (expected === null ? cur !== undefined : cur?.payload.updatedAt !== expected) return false;
      cloud.set(rowKey(store, key), { store, key, payload });
      return true;
    },
    deleteLocalStorePagedRecords: async (_uid: string, store: string, key: string) => {
      for (const [k, r] of cloud) if (r.store === store && r.key.startsWith(`${key}#`)) cloud.delete(k);
    },
    deleteLocalStoreRecord: async (_uid: string, store: string, key: string) => {
      cloud.delete(rowKey(store, key));
    },
  },
}));

vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: UID, email: 'someone@example.com' }),
  getCurrentUserId: () => UID,
}));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

describe('T-1 (R-7): шифрование documentId в head-строке диалога', () => {
  let mockKey: CryptoKey;

  beforeEach(async () => {
    vi.clearAllMocks();
    cloud.clear();
    localStorage.clear();
    resetDbInstance();

    setProfileLoaded(UID, true);
    setEncryptionEnabled(UID, true);

    mockKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
    setSessionKey(mockKey);

    const db = await getLocalDb(UID);
    for (const name of ['documents', 'aiDialogues', 'aiChatMemory', 'aiDialogueEvents', 'syncQueue'] as const) {
      if (db.objectStoreNames.contains(name)) await db.clear(name);
    }
  });

  afterEach(async () => {
    clearSessionKey();
    resetDbInstance();
  });

  it('head-строка под сейфом не содержит открытого note id, round-trip восстанавливает documentId, и каскад удаления заметки находит диалог', async () => {
    const NOTE_ID = 'doc_secret_note_123';
    const DLG_ID = 'dlg_enc_1';

    const db = await getLocalDb(UID);
    await db.put('documents', { id: NOTE_ID, title: 'Секретная заметка', currentVersion: 1, guestId: UID } as never);

    const BLOB = 'ж'.repeat(95_000);
    const dialogue: AIDialogue = {
      id: DLG_ID,
      documentId: NOTE_ID,
      title: 'Секретный диалог о заметке',
      personaId: 'coach',
      personaName: 'Коуч',
      personaEmoji: '🎯',
      createdAt: 1000,
      updatedAt: 2000,
      messages: [
        { id: 'm1', role: 'user', content: `Вопрос по заметке ${BLOB}`, createdAt: 1000 },
        { id: 'm2', role: 'assistant', content: `Ответ коуча ${BLOB}`, createdAt: 1001 },
        { id: 'm3', role: 'user', content: `Рассуждение ${BLOB}`, createdAt: 1002 },
      ],
    };
    await db.put('aiDialogues', dialogue as never);
    LocalStoreSyncService.scheduleStoreSync('aiDialogues', DLG_ID);

    // 1. Выгрузка в облако
    const syncRes = await LocalStoreSyncService.flushPending(true);
    expect(syncRes.failed).toBe(0);

    // 2. Проверка сериализованной строки в облаке: note id не должен быть открытым текстом
    const headRow = cloud.get(rowKey('aiDialogues', DLG_ID));
    expect(headRow, 'head-строка выгружена в облако').toBeDefined();
    const serialized = JSON.stringify(headRow!.payload);
    expect(serialized).not.toContain(NOTE_ID);
    expect(headRow!.payload._encrypted).toBe(true);
    expect(typeof headRow!.payload.documentId).toBe('string');
    expect(headRow!.payload.documentId).not.toBe(NOTE_ID);

    // 3. Round-trip: очищаем локальную базу диалогов и восстанавливаем из облака
    await db.delete('aiDialogues', DLG_ID);
    const beforeRestore = await db.get('aiDialogues', DLG_ID);
    expect(beforeRestore).toBeUndefined();

    const restoreRes = await restoreAIDataFromCloud(UID);
    expect(restoreRes.failed).toBe(0);

    const restored = (await db.get('aiDialogues', DLG_ID)) as AIDialogue | undefined;
    expect(restored, 'диалог восстановлен из облака').toBeDefined();
    expect(restored!.documentId).toBe(NOTE_ID);
    expect(restored!.title).toBe('Секретный диалог о заметке');

    // 4. Каскад удаления заметки находит диалог по documentId и ставит надгробие
    await LocalDocumentService.deleteDocument(NOTE_ID, UID);
    const afterCascade = (await db.get('aiDialogues', DLG_ID)) as AIDialogue | undefined;
    expect(afterCascade, 'диалог найден в базе после каскада').toBeDefined();
    expect(afterCascade!.deletedAt, 'диалог надгроблен каскадом').toBeDefined();
    expect(typeof afterCascade!.deletedAt).toBe('number');
  });
});
