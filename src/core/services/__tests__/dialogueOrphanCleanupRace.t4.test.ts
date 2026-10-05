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

type Row = { store: string; key: string; payload: Record<string, unknown>; stamped_at?: unknown };
const cloud = new Map<string, Row>();
const rowKey = (store: string, key: string) => `${store}:${key}`;

let onBeforeDeletePaged: (() => Promise<void>) | null = null;
let onBeforeDeleteKeys: ((keys: string[]) => Promise<void>) | null = null;
let onAfterGetRecord: ((store: string, key: string) => Promise<void>) | null = null;

vi.mock('../../data', async () => {
  const actual = await vi.importActual<typeof import('../../data')>('../../data');
  return {
    ...actual,
    DataProvider: {
      getLocalStoreRecordsByKeyPrefix: async (_uid: string, store: string, prefix: string) =>
        [...cloud.values()]
          .filter(r => r.store === store && r.key.startsWith(prefix))
          .map(r => actual.rowToLocalStoreRecord(r as Record<string, unknown>)),
      deleteLocalStoreRecordsByKeys: async (_uid: string, store: string, keys: string[]) => {
        if (onBeforeDeleteKeys) {
          const hook = onBeforeDeleteKeys;
          onBeforeDeleteKeys = null;
          await hook(keys);
        }
        for (const k of keys) cloud.delete(rowKey(store, k));
      },
      getUserSummaries: async () => [],
      getUserEmbeddingsPaginated: async () => ({ items: [], nextCursorId: null, readCount: 0 }),
      getLocalStoreRecords: async (_uid: string, store?: string, since?: number) =>
        [...cloud.values()]
          .filter(r => (!store || r.store === store) && (since === undefined || Number(r.payload.updatedAt) > since))
          .sort((a, b) => a.store.localeCompare(b.store) || a.key.localeCompare(b.key))
          .map(r => actual.rowToLocalStoreRecord(r as Record<string, unknown>)),
      getLocalStoreRecord: async (_uid: string, store: string, key: string) => {
        const r = cloud.get(rowKey(store, key));
        const res = r ? actual.rowToLocalStoreRecord(r as Record<string, unknown>) : null;
        if (onAfterGetRecord) {
          const hook = onAfterGetRecord;
          await hook(store, key);
        }
        return res;
      },
      getLocalStoreRecordPages: async (_uid: string, store: string, key: string) =>
        [...cloud.values()]
          .filter(r => r.store === store && r.key.startsWith(`${key}#`))
          .map(r => actual.rowToLocalStoreRecord(r as Record<string, unknown>)),
      saveLocalStoreRecord: async (_uid: string, store: string, key: string, payload: Record<string, unknown>) => {
        cloud.set(rowKey(store, key), { store, key, payload, stamped_at: Date.now() });
      },
      saveLocalStoreRecordPages: async (_uid: string, store: string, pages: Array<{ key: string; payload: Record<string, unknown> }>) => {
        for (const p of pages) cloud.set(rowKey(store, p.key), { store, key: p.key, payload: p.payload, stamped_at: Date.now() });
      },
      saveLocalStoreRecordIfUnchanged: async (_uid: string, store: string, key: string, payload: Record<string, unknown>, expected: number | null) => {
        const cur = cloud.get(rowKey(store, key));
        if (expected === null ? cur !== undefined : cur?.payload.updatedAt !== expected) return false;
        cloud.set(rowKey(store, key), { store, key, payload, stamped_at: Date.now() });
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
  };
});

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
    onBeforeDeleteKeys = null;
    onAfterGetRecord = null;
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

  it('T-8: grace check preserves windows when B head lands after A re-reads head and segment updatedAt is 30 min old', async () => {
    const DLG_ID = 'dlg_race_t8_reviewer';
    const BLOB = 'ж'.repeat(95_000);
    const now = Date.now();

    // Устройство B локально держало большой диалог, отредактированный 30 минут назад
    const dbB = await getLocalDb(`${UID}_B`);
    const bigDialogue: AIDialogue = {
      id: DLG_ID,
      title: 'Большой диалог B',
      personaId: 'coach',
      personaName: 'Коуч',
      personaEmoji: '🎯',
      createdAt: now - 35 * 60_000,
      updatedAt: now - 30 * 60_000, // 30 минут назад!
      messages: [
        { id: 'm1', role: 'user', content: `Вопрос B1 ${BLOB}`, createdAt: now - 35 * 60_000 },
        { id: 'm2', role: 'assistant', content: `Ответ B1 ${BLOB}`, createdAt: now - 35 * 60_000 + 1 },
        { id: 'm3', role: 'user', content: `Вопрос B2 ${BLOB}`, createdAt: now - 30 * 60_000 },
      ],
    };
    await dbB.put('aiDialogues', bigDialogue as never);

    // B только что выгрузило сегменты в облако (серверная отметка stamped_at = now),
    // но с updatedAt из payload = now - 30 мин (время устройства B)
    const segKey1 = `${DLG_ID}@seg${now - 35 * 60_000}-aaaaaaaa`;
    const segKey2 = `${DLG_ID}@seg${now - 30 * 60_000}-bbbbbbbb`;
    cloud.set(rowKey('aiDialogues', segKey1), {
      store: 'aiDialogues',
      key: segKey1,
      payload: {
        seg: true,
        headKey: DLG_ID,
        firstAt: now - 35 * 60_000,
        lastAt: now - 35 * 60_000 + 1,
        updatedAt: now - 30 * 60_000, // 30 минут назад
        messages: JSON.stringify(bigDialogue.messages.slice(0, 2)),
      },
      stamped_at: now, // Серверный штамп: свежий!
    });
    cloud.set(rowKey('aiDialogues', segKey2), {
      store: 'aiDialogues',
      key: segKey2,
      payload: {
        seg: true,
        headKey: DLG_ID,
        firstAt: now - 30 * 60_000,
        lastAt: now - 30 * 60_000,
        updatedAt: now - 30 * 60_000, // 30 минут назад
        messages: JSON.stringify(bigDialogue.messages.slice(2)),
      },
      stamped_at: now, // Серверный штамп: свежий!
    });

    // Устройство A локально держит маленький диалог
    const dbA = await getLocalDb(UID);
    const smallDialogue: AIDialogue = {
      id: DLG_ID,
      title: 'Маленький диалог A',
      personaId: 'coach',
      personaName: 'Коуч',
      personaEmoji: '🎯',
      createdAt: now - 35 * 60_000,
      updatedAt: now,
      messages: [{ id: 'm0', role: 'user', content: 'Привет от A', createdAt: now - 35 * 60_000 }],
    };
    await dbA.put('aiDialogues', smallDialogue as never);
    LocalStoreSyncService.scheduleStoreSync('aiDialogues', DLG_ID);

    // Тайминг ревьюера: B's head write lands after A re-reads the head and before A deletes
    let reReadCount = 0;
    onAfterGetRecord = async (store, k) => {
      if (store === 'aiDialogues' && k === DLG_ID) {
        reReadCount++;
        // 1-я выборка — readCloudDialogue перед выгрузкой A
        // 2-я выборка — re-read текущего head непосредственно перед deleteSafeOrphanWindows
        if (reReadCount === 2) {
          const headPayload = {
            head: true,
            id: DLG_ID,
            title: bigDialogue.title,
            personaId: bigDialogue.personaId,
            personaName: bigDialogue.personaName,
            personaEmoji: bigDialogue.personaEmoji,
            createdAt: bigDialogue.createdAt,
            updatedAt: now,
            schema: 2,
            segments: [
              { key: segKey1, firstAt: now - 35 * 60_000, lastAt: now - 35 * 60_000 + 1, updatedAt: now - 30 * 60_000, bytes: 380000, count: 2 },
              { key: segKey2, firstAt: now - 30 * 60_000, lastAt: now - 30 * 60_000, updatedAt: now - 30 * 60_000, bytes: 190000, count: 1 },
            ],
          };
          cloud.set(rowKey('aiDialogues', DLG_ID), {
            store: 'aiDialogues',
            key: DLG_ID,
            payload: headPayload,
            stamped_at: now,
          });
        }
      }
    };

    // A делает flushPending.
    // Если stamped_at потерян провайдером, A посчитает возраст по payload.updatedAt (30 мин > 10 мин grace)
    // и снесёт segKey1 и segKey2!
    // С правильным пробросом stamped_at A видит, что строки свежее 10 минут, и не удаляет их.
    await LocalStoreSyncService.flushPending(true);

    expect(cloud.get(rowKey('aiDialogues', segKey1)), 'окно segKey1 должно сохраниться по grace-периоду server stamped_at').toBeDefined();
    expect(cloud.get(rowKey('aiDialogues', segKey2)), 'окно segKey2 должно сохраниться по grace-периоду server stamped_at').toBeDefined();

    // Свежее устройство C восстанавливает данные из облака
    resetDbInstance();
    const dbC = await getLocalDb(`${UID}_C`);
    const restoreRes = await restoreAIDataFromCloud(`${UID}_C`);
    expect(restoreRes.failed, 'восстановление на свежем устройстве должно пройти без ошибок').toBe(0);

    const restored = (await dbC.get('aiDialogues', DLG_ID)) as AIDialogue | undefined;
    expect(restored, 'диалог должен быть успешно восстановлен').toBeDefined();
    expect(restored!.messages.length).toBeGreaterThanOrEqual(2);
  });

  it('T-8: неизвестный серверный штамп (stamped_at отсутствует) -> окно сохраняется', async () => {
    const DLG_ID = 'dlg_race_unknown_stamp';
    const now = Date.now();

    // Окно без stamped_at (старая строка или провайдер не вернул отметку)
    const segKey = `${DLG_ID}@seg${now - 20 * 60_000}-unknown`;
    cloud.set(rowKey('aiDialogues', segKey), {
      store: 'aiDialogues',
      key: segKey,
      payload: {
        seg: true,
        headKey: DLG_ID,
        firstAt: now - 20 * 60_000,
        lastAt: now - 20 * 60_000,
        updatedAt: now - 20 * 60_000,
        messages: JSON.stringify([{ id: 'm1', role: 'user', content: 'test', createdAt: now - 20 * 60_000 }]),
      },
      // stamped_at не задан!
    });

    // Устройство A выгружает мелкий диалог
    const dbA = await getLocalDb(UID);
    await dbA.put('aiDialogues', {
      id: DLG_ID,
      title: 'Диалог A',
      personaId: 'coach',
      personaName: 'Коуч',
      createdAt: now,
      updatedAt: now,
      messages: [{ id: 'm0', role: 'user', content: 'hello', createdAt: now }],
    } as never);
    LocalStoreSyncService.scheduleStoreSync('aiDialogues', DLG_ID);

    await LocalStoreSyncService.flushPending(true);

    // Окно с неизвестным штампом НЕ должно быть снесено: правило «unknown stamp -> keep the window»
    expect(cloud.get(rowKey('aiDialogues', segKey)), 'окно без stamped_at должно сохраниться').toBeDefined();
  });

  it('T-8: отказ в восстановлении из-за нехватки окна триггерит re-upload диалога писателем', async () => {
    const DLG_ID = 'dlg_missing_repair';
    const db = await getLocalDb(UID);
    const dialogue: AIDialogue = {
      id: DLG_ID,
      title: 'Диалог для починки',
      personaId: 'coach',
      personaName: 'Коуч',
      personaEmoji: '🎯',
      createdAt: 1000,
      updatedAt: 2000,
      messages: [{ id: 'm1', role: 'user', content: 'Привет', createdAt: 1000 }],
    };
    await db.put('aiDialogues', dialogue as never);

    // В облаке head называет окно, которого физически нет
    const missingSegKey = `${DLG_ID}@seg1000-gone`;
    cloud.set(rowKey('aiDialogues', DLG_ID), {
      store: 'aiDialogues',
      key: DLG_ID,
      payload: {
        head: true,
        id: DLG_ID,
        title: dialogue.title,
        personaId: dialogue.personaId,
        personaName: dialogue.personaName,
        createdAt: dialogue.createdAt,
        updatedAt: 1500,
        schema: 2,
        segments: [{ key: missingSegKey, firstAt: 1000, lastAt: 1001, updatedAt: 1500, bytes: 100, count: 1 }],
      },
      stamped_at: Date.now(),
    });

    const spy = vi.spyOn(LocalStoreSyncService, 'scheduleStoreSync');
    const res = await restoreAIDataFromCloud(UID);
    expect(res.failed).toBe(1);
    expect(spy).toHaveBeenCalledWith('aiDialogues', DLG_ID);
    spy.mockRestore();
  });
});
