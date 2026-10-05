import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance } from '../../storage/localDb';
import type { AIDialogue } from '../../storage/localDb';
import { LocalStoreSyncService } from '../LocalStoreSyncService';
import { restoreAIDataFromCloud } from '../../../features/ai/services/AIRestoreService';

// T-4 (R-2): гонка очистки осиротевших окон.
// A (одиночная строка) выигрывает CAS. B успевает выгрузить сегментный диалог
// (переиспользовав одно из окон) до того, как A сделает cleanup.
// A не имеет права сносить окно, которое (a) назвал текущий head или (b) свежее 10 минут.

const UID = 'u_t4_race';

type Row = { store: string; key: string; payload: Record<string, unknown> };
const cloud = new Map<string, Row>();
const rowKey = (store: string, key: string) => `${store}:${key}`;

let onBeforeDeletePaged: (() => Promise<void>) | null = null;

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
      [...cloud.values()]
        .filter(r => (!store || r.store === store) && (since === undefined || Number(r.payload.updatedAt) > since))
        .sort((a, b) => a.store.localeCompare(b.store) || a.key.localeCompare(b.key)),
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
      if (onBeforeDeletePaged) {
        const hook = onBeforeDeletePaged;
        onBeforeDeletePaged = null;
        await hook();
      }
      for (const [k, r] of cloud) if (r.store === store && r.key.startsWith(`${key}#`)) cloud.delete(k);
    },
    deleteLocalStoreRecord: async (_uid: string, store: string, key: string) => {
      cloud.delete(rowKey(store, key));
    },
  },
}));

vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: UID, email: 'u@example.com' }),
  getCurrentUserId: () => UID,
}));
vi.mock('../../sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => false }));
vi.mock('../../crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeDecrypt: async (doc: Record<string, unknown>) => doc,
  maybeEncrypt: async (doc: Record<string, unknown>) => doc,
}));
vi.mock('../../crypto/encrypt', () => ({ getSessionKey: () => null }));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

describe('T-4 (R-2): гонка очистки сирот с параллельной выгрузкой head', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    cloud.clear();
    localStorage.clear();
    onBeforeDeletePaged = null;
    resetDbInstance();
  });

  afterEach(async () => {
    resetDbInstance();
  });

  it('A не сносит окно, которое успел занять head устройства B во время deleteLocalStorePagedRecords', async () => {
    const DLG_ID = 'dlg_race_1';
    const BLOB = 'ж'.repeat(95_000);

    // Устройство B локально держит большой диалог
    const dbB = await getLocalDb(`${UID}_B`);
    const bigDialogue: AIDialogue = {
      id: DLG_ID,
      title: 'Большой диалог B',
      personaId: 'coach',
      personaName: 'Коуч',
      personaEmoji: '🎯',
      createdAt: 1000,
      updatedAt: 2000,
      messages: [
        { id: 'm1', role: 'user', content: `Вопрос B1 ${BLOB}`, createdAt: 1000 },
        { id: 'm2', role: 'assistant', content: `Ответ B1 ${BLOB}`, createdAt: 1001 },
        { id: 'm3', role: 'user', content: `Вопрос B2 ${BLOB}`, createdAt: 1002 },
      ],
    };
    await dbB.put('aiDialogues', bigDialogue as never);

    // В облаке лежат осиротевшие сегменты от оборванной попытки B
    const segKey1 = `${DLG_ID}@seg1000-aaaaaaaa`;
    const segKey2 = `${DLG_ID}@seg1002-bbbbbbbb`;
    const now = Date.now();
    cloud.set(rowKey('aiDialogues', segKey1), {
      store: 'aiDialogues',
      key: segKey1,
      payload: {
        seg: true,
        headKey: DLG_ID,
        firstAt: 1000,
        lastAt: 1001,
        updatedAt: now,
        messages: JSON.stringify(bigDialogue.messages.slice(0, 2)),
      },
    });
    cloud.set(rowKey('aiDialogues', segKey2), {
      store: 'aiDialogues',
      key: segKey2,
      payload: {
        seg: true,
        headKey: DLG_ID,
        firstAt: 1002,
        lastAt: 1002,
        updatedAt: now,
        messages: JSON.stringify(bigDialogue.messages.slice(2)),
      },
    });

    // Устройство A локально держит маленький диалог
    const dbA = await getLocalDb(UID);
    const smallDialogue: AIDialogue = {
      id: DLG_ID,
      title: 'Маленький диалог A',
      personaId: 'coach',
      personaName: 'Коуч',
      personaEmoji: '🎯',
      createdAt: 1000,
      updatedAt: 3000,
      messages: [
        { id: 'm0', role: 'user', content: 'Привет от A', createdAt: 1000 },
      ],
    };
    await dbA.put('aiDialogues', smallDialogue as never);
    LocalStoreSyncService.scheduleStoreSync('aiDialogues', DLG_ID);

    // Интерливинг: ровно внутри deleteLocalStorePagedRecords устройства A
    // просыпается устройство B и выгружает свой сегментный диалог (который принимает segKey1 и segKey2)
    onBeforeDeletePaged = async () => {
      // Имитируем выгрузку устройства B
      // B строит план, переиспользует segKey1 и segKey2 и делает CAS head'а
      const headPayload = {
        head: true,
        id: DLG_ID,
        title: bigDialogue.title,
        personaId: bigDialogue.personaId,
        personaName: bigDialogue.personaName,
        personaEmoji: bigDialogue.personaEmoji,
        createdAt: bigDialogue.createdAt,
        updatedAt: 4000, // Серверная отметка B
        schema: 2,
        segments: [
          { key: segKey1, firstAt: 1000, lastAt: 1001, updatedAt: now, bytes: 380000, count: 2 },
          { key: segKey2, firstAt: 1002, lastAt: 1002, updatedAt: now, bytes: 190000, count: 1 },
        ],
      };
      cloud.set(rowKey('aiDialogues', DLG_ID), {
        store: 'aiDialogues',
        key: DLG_ID,
        payload: headPayload,
      });
    };

    // A делает flushPending (выигрывает CAS до нашего хука, затем входит в хук, затем выполняет cleanup)
    await LocalStoreSyncService.flushPending(true);

    // Проверяем: окна segKey1 и segKey2, названные текущим head'ом B, ДОЛЖНЫ ОСТАТЬСЯ в облаке!
    expect(cloud.get(rowKey('aiDialogues', segKey1)), 'окно segKey1 не должно быть удалено').toBeDefined();
    expect(cloud.get(rowKey('aiDialogues', segKey2)), 'окно segKey2 не должно быть удалено').toBeDefined();

    // Свежее устройство C восстанавливает данные из облака
    resetDbInstance();
    const dbC = await getLocalDb(`${UID}_C`);
    const restoreRes = await restoreAIDataFromCloud(`${UID}_C`);
    expect(restoreRes.failed, 'восстановление не должно падать из-за удалённого окна').toBe(0);

    const restored = (await dbC.get('aiDialogues', DLG_ID)) as AIDialogue | undefined;
    expect(restored, 'диалог должен быть успешно восстановлен').toBeDefined();
    expect(restored!.messages.length).toBeGreaterThanOrEqual(2);
  });

  it('писатель чинит неполную облачную копию (если окно всё же пропало, перевыгружает его)', async () => {
    const DLG_ID = 'dlg_repair_1';
    const BLOB = 'ж'.repeat(95_000);

    const db = await getLocalDb(UID);
    const dialogue: AIDialogue = {
      id: DLG_ID,
      title: 'Диалог для починки',
      personaId: 'coach',
      personaName: 'Коуч',
      personaEmoji: '🎯',
      createdAt: 1000,
      updatedAt: 2000,
      messages: [
        { id: 'm1', role: 'user', content: `Вопрос ${BLOB}`, createdAt: 1000 },
        { id: 'm2', role: 'assistant', content: `Ответ ${BLOB}`, createdAt: 1001 },
      ],
    };
    await db.put('aiDialogues', dialogue as never);

    // В облаке head называет окно, которого НЕТ в облаке (пропавшее окно)
    const missingSegKey = `${DLG_ID}@seg1000-missing1`;
    cloud.set(rowKey('aiDialogues', DLG_ID), {
      store: 'aiDialogues',
      key: DLG_ID,
      payload: {
        head: true,
        id: DLG_ID,
        title: dialogue.title,
        personaId: dialogue.personaId,
        personaName: dialogue.personaName,
        personaEmoji: dialogue.personaEmoji,
        createdAt: dialogue.createdAt,
        updatedAt: 1500,
        schema: 2,
        segments: [{ key: missingSegKey, firstAt: 1000, lastAt: 1001, updatedAt: 1500, bytes: 380000, count: 2 }],
      },
    });

    // Писатель выгружает диалог
    LocalStoreSyncService.scheduleStoreSync('aiDialogues', DLG_ID);
    const syncRes = await LocalStoreSyncService.flushPending(true);
    expect(syncRes.failed).toBe(0);

    // Head в облаке обновлён и указывает на новое живое окно, которое реально есть в облаке
    const headRow = cloud.get(rowKey('aiDialogues', DLG_ID));
    expect(headRow).toBeDefined();
    const segments = (headRow!.payload.segments as Array<{ key: string }>);
    expect(segments.length).toBeGreaterThan(0);
    const newSegKey = segments[0]!.key;
    expect(cloud.get(rowKey('aiDialogues', newSegKey)), 'новое окно должно существовать в облаке').toBeDefined();
  });
});
