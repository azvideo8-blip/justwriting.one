import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance } from '../../storage/localDb';
import type { AIDialogue } from '../../storage/localDb';
import {
  LocalStoreSyncService,
  ORPHAN_GRACE_PERIOD_MS,
} from '../LocalStoreSyncService';

// R7Q-007: надгробие диалога не может убрать окна моложе grace — и после grace
// их никто обратно в очередь не ставит. Удалил диалог сразу после ответа ИИ →
// ходы живут в облаке, пока не истечёт само надгробие (90 дней).
//
// Что обязан делать правка: пропускаешь окно по grace — поставь ОДИН отложенный
// повтор на ORPHAN_GRACE_PERIOD_MS + 60 с, повтори проход и убери.

const UID = 'u_r7q007';
/** Кто сейчас вошёл: кейс смены аккаунта переключает его до срабатывания повтора. */
const who = vi.hoisted(() => ({ uid: 'u_r7q007' }));
const T0 = Date.UTC(2026, 9, 16, 12, 0, 0);
/** Тикет: повтор ставится на grace + 60 с. Пишем срок здесь, а не импортом,
 *  чтобы тест был красным на посадке по поведению, а не по несуществующему имени. */
const ORPHAN_RETRY_DELAY_MS = ORPHAN_GRACE_PERIOD_MS + 60_000;

type Row = { store: string; key: string; payload: Record<string, unknown>; stamped_at?: unknown };
const cloud = new Map<string, Row>();
const rowKey = (store: string, key: string) => `${store}:${key}`;

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
        for (const k of keys) cloud.delete(rowKey(store, k));
      },
      getUserSummaries: async () => [],
      getUserEmbeddingsPaginated: async () => ({ items: [], nextCursorId: null, readCount: 0 }),
      getLocalStoreRecords: async () => [],
      getLocalStoreRecord: async (_uid: string, store: string, key: string) => {
        const r = cloud.get(rowKey(store, key));
        return r ? actual.rowToLocalStoreRecord(r as Record<string, unknown>) : null;
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
      deleteLocalStorePagedRecords: async () => {},
      deleteLocalStoreRecord: async (_uid: string, store: string, key: string) => {
        cloud.delete(rowKey(store, key));
      },
    },
  };
});

vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: who.uid, email: 'person@example.com' }),
  getCurrentUserId: () => who.uid,
}));
// Облако включено: отложенный повтор идёт штатным путём (flushPending без
// forceManual), и при выключенном согласии он бы молча выходил.
vi.mock('../../sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeDecrypt: async (doc: Record<string, unknown>) => doc,
  maybeEncrypt: async (doc: Record<string, unknown>) => doc,
}));
vi.mock('../../crypto/encrypt', () => ({ getSessionKey: () => null }));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../shared/errors/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

let setTimeouts: ReturnType<typeof vi.spyOn>;

/** Сколько раз за прогон был поставлен таймер именно на отложенный повтор уборки. */
function orphanRetryTimerCount(): number {
  return setTimeouts.mock.calls.filter((c: unknown[]) => c[1] === ORPHAN_RETRY_DELAY_MS).length;
}

/**
 * fake-таймеры переводят стрелки, но fake-indexeddb живёт на настоящем
 * setImmediate: отложенный повтор выстреливает и оставляет проход «доезжать»
 * уже на реальном событийном цикле. Поэтому цикл «перевели часы → дождались
 * событийного цикла» крутим несколько раз: постановка в очередь сама идёт после
 * await'а, и её дебаунс появляется уже на переведённых часах.
 */
async function advanceAndDrain(ms: number, rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await vi.advanceTimersByTimeAsync(ms);
    for (let k = 0; k < 60; k++) await new Promise<void>(resolve => setImmediate(resolve));
  }
}

function dialogue(id: string): AIDialogue {
  return {
    id,
    title: 'Разговор',
    personaId: 'coach',
    personaName: 'Коуч',
    personaEmoji: '🎯',
    createdAt: T0 - 60_000,
    updatedAt: T0,
    messages: [
      { id: 'm1', role: 'user', content: 'Вопрос', createdAt: T0 - 60_000 },
      { id: 'm2', role: 'assistant', content: 'Ответ', createdAt: T0 },
    ],
  };
}

/** В облаке — осиротевшее окно, поставленное ровно «сейчас» (моложе grace). */
function seedFreshOrphan(dlgId: string): string {
  const segKey = `${dlgId}@seg${T0 - 60_000}-aaaaaaaa`;
  cloud.set(rowKey('aiDialogues', segKey), {
    store: 'aiDialogues',
    key: segKey,
    payload: {
      seg: true,
      headKey: dlgId,
      firstAt: T0 - 60_000,
      lastAt: T0,
      updatedAt: T0,
      messages: JSON.stringify(dialogue(dlgId).messages),
    },
    stamped_at: T0,
  });
  return segKey;
}

async function putLocalDialogue(dlgId: string): Promise<void> {
  const db = await getLocalDb(UID);
  await db.put('aiDialogues', dialogue(dlgId) as never);
}

describe('R7Q-007: окно, пропущенное по grace, возвращается в очередь само', () => {
  beforeEach(() => {
    // Фейковые только setTimeout/clearTimeout/Date: fake-indexeddb живёт на
    // setImmediate, и полный перехват таймеров повесил бы транзакции IDB.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(T0);
    cloud.clear();
    localStorage.clear();
    resetDbInstance();
    who.uid = UID;
    setTimeouts = vi.spyOn(globalThis, 'setTimeout');
  });

  afterEach(() => {
    setTimeouts.mockRestore();
    vi.useRealTimers();
    resetDbInstance();
  });

  it('проход не трогает свежее окно, но ставит РОВНО ОДИН повтор на grace + 60 с', async () => {
    const DLG = 'dlg_r7q007_once';
    const segKey = seedFreshOrphan(DLG);
    await putLocalDialogue(DLG);

    LocalStoreSyncService.scheduleStoreSync('aiDialogues', DLG);
    await LocalStoreSyncService.flushPending(true);

    expect(ORPHAN_RETRY_DELAY_MS, 'повтор обязан быть позже самого grace').toBeGreaterThan(ORPHAN_GRACE_PERIOD_MS);
    expect(cloud.has(rowKey('aiDialogues', segKey)), 'окно моложе grace удалять нельзя').toBe(true);
    expect(orphanRetryTimerCount(), 'пропуск по grace обязан запланировать один повтор').toBe(1);
  });

  it('два пропуска подряд не плодят таймеры: защита от двойного планирования', async () => {
    const DLG = 'dlg_r7q007_dedup';
    seedFreshOrphan(DLG);
    await putLocalDialogue(DLG);

    LocalStoreSyncService.scheduleStoreSync('aiDialogues', DLG);
    await LocalStoreSyncService.flushPending(true);
    // Второй проход того же диалога — то же самое окно, тот же самый повтор.
    LocalStoreSyncService.scheduleStoreSync('aiDialogues', DLG);
    await LocalStoreSyncService.flushPending(true);

    expect(orphanRetryTimerCount(), 'повтор для одной пары uid:диалог ставится один раз').toBe(1);
  });

  it('по истечении повтора окно убрано, а очередь выдоена без новых таймеров', async () => {
    const DLG = 'dlg_r7q007_drain';
    const segKey = seedFreshOrphan(DLG);
    await putLocalDialogue(DLG);

    LocalStoreSyncService.scheduleStoreSync('aiDialogues', DLG);
    await LocalStoreSyncService.flushPending(true);
    expect(cloud.has(rowKey('aiDialogues', segKey))).toBe(true);

    // grace + 60 с, затем штатный дебаунс очереди
    await advanceAndDrain(ORPHAN_RETRY_DELAY_MS + 2_000);

    expect(cloud.has(rowKey('aiDialogues', segKey)), 'окно старше grace обязано быть удалено').toBe(false);
    expect(orphanRetryTimerCount(), 'убранное окно не запланирует ещё один повтор').toBe(1);
  });

  it('диалог, удалённый сразу после ответа ИИ, не оставляет окон в облаке навсегда', async () => {
    const DLG = 'dlg_r7q007_tomb';
    const segKey = seedFreshOrphan(DLG);
    await putLocalDialogue(DLG);
    const db = await getLocalDb(UID);
    const row = await db.get('aiDialogues', DLG);
    expect(row).toBeDefined();

    // Человек удалил диалог: локально остаётся только надгробие.
    await db.delete('aiDialogues', DLG);
    await db.put('aiDialogues', {
      ...dialogue(DLG),
      deletedAt: T0 + 1,
      messages: [],
      updatedAt: T0 + 1,
    } as never);

    LocalStoreSyncService.scheduleStoreSync('aiDialogues', DLG);
    await LocalStoreSyncService.flushPending(true);
    expect(orphanRetryTimerCount(), 'надгробие, не сумевшее убрать свежее окно, планируют повторно').toBe(1);

    await advanceAndDrain(ORPHAN_RETRY_DELAY_MS + 2_000);
    expect(cloud.has(rowKey('aiDialogues', segKey)), 'после повтора окна надгробия в облаке нет').toBe(false);
  });

  // /code-review 0.10.0: защита «аккаунт сменился за 11 минут» не проверялась —
  // мок отдавал одного пользователя всегда. Мутация: убрать проверку uid в
  // scheduleOrphanRetry → красный.
  it('повтор, сработавший после смены аккаунта, не ставит чужой диалог в очередь', async () => {
    const DLG = 'dlg_r7q007_switch';
    seedFreshOrphan(DLG);
    await putLocalDialogue(DLG);

    LocalStoreSyncService.scheduleStoreSync('aiDialogues', DLG);
    await LocalStoreSyncService.flushPending(true);
    expect(orphanRetryTimerCount()).toBe(1);

    who.uid = 'u_other_account';
    const schedule = vi.spyOn(LocalStoreSyncService, 'scheduleStoreSync');
    vi.advanceTimersByTime(ORPHAN_RETRY_DELAY_MS + 1);
    expect(schedule, 'диалог прежнего аккаунта попал в очередь нового').not.toHaveBeenCalled();
    schedule.mockRestore();
  });
});
