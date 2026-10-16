import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance } from '../../storage/localDb';
import type { AIDialogue } from '../../storage/localDb';
import { LocalStoreSyncService } from '../LocalStoreSyncService';

// R7Q-005 (T-9): проигравший CAS сносит окна, которые победитель уже назвал.
//
// Порядок, в котором это случается на проде:
//   1. в облаке нет head, есть осиротевшее окно W1 (обрванная попытка);
//   2. устройство L (здесь — тот, кто гоняет настоящий LocalStoreSyncService)
//      читает облако, переиспользует W1 и дописывает своё свежее окно W2;
//   3. пока L пишет, устройство A перечитывает облако, принимает W1 и W2 (байты
//      совпали — план переиспользует чужие строки) и выигрывает CAS head'ом,
//      который НАЗЫВАЕТ W2;
//   4. L ставит свой head под условием «облако не изменилось» — проигрывает и по
//      прежнему коду удаляет «свои» строки из этой попытки, то же W2.
//
// Итог: head победителя ссылается на несуществующее окно, и третий читатель
// (readSegmentVersion) отказывает всему диалогу — не «половина дневника», а
// ничего. Тикет просил сначала воспроизвести: этот тест и есть воспроизведение.

const UID = 'u_r7q005_loser';

type Row = { store: string; key: string; payload: Record<string, unknown>; stamped_at?: unknown };
const cloud = new Map<string, Row>();
const rowKey = (store: string, key: string) => `${store}:${key}`;

/** После записи окон: в этот момент «просыпается» победитель. */
let onAfterSavePages: ((keys: string[]) => Promise<void>) | null = null;
/** Ключи, удалённые в момент, когда их называл head в облаке, — это и есть находка. */
const deletedWhileNamed: string[] = [];
/** Ссылки текущего head'а, оставшиеся без строки после удаления. */
const danglingAfterDelete: string[] = [];
/** Сколько раз условная запись не прошла: холостой тест виден сразу. */
let casLosses = 0;
/** Окна, которые назвал head победителя. */
let winnerKeys: string[] = [];
/** Окно, которое проигравший записал в этой же попытке. */
let loserKey = '';

/** Окна, которые текущий head в облаке называет живыми. */
function headNamed(): Set<string> {
  const head = cloud.get(rowKey('aiDialogues', DLG_ID));
  const segs = (head?.payload.segments as Array<{ key?: unknown }> | undefined) ?? [];
  return new Set(segs.map(s => s.key).filter((k): k is string => typeof k === 'string'));
}

vi.mock('../../data', async () => {
  const actual = await vi.importActual<typeof import('../../data')>('../../data');
  return {
    ...actual,
    DataProvider: {
      getLocalStoreRecordsByKeyPrefix: async (_uid: string, store: string, prefix: string) =>
        [...cloud.values()]
          .filter(r => r.store === store && r.key.startsWith(prefix))
          .map(r => actual.rowToLocalStoreRecord(r as Record<string, unknown>)),
      getLocalStoreRecords: async (_uid: string, store?: string, since?: number) =>
        [...cloud.values()]
          .filter(r => (!store || r.store === store) && (since === undefined || Number(r.payload.updatedAt) > since))
          .sort((a, b) => a.store.localeCompare(b.store) || a.key.localeCompare(b.key))
          .map(r => actual.rowToLocalStoreRecord(r as Record<string, unknown>)),
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
        if (onAfterSavePages) {
          const hook = onAfterSavePages;
          onAfterSavePages = null;
          await hook(pages.map(p => p.key));
        }
      },
      saveLocalStoreRecordIfUnchanged: async (_uid: string, store: string, key: string, payload: Record<string, unknown>, expected: number | null) => {
        const cur = cloud.get(rowKey(store, key));
        if (expected === null ? cur !== undefined : cur?.payload.updatedAt !== expected) {
          casLosses += 1;
          return false;
        }
        cloud.set(rowKey(store, key), { store, key, payload, stamped_at: Date.now() });
        return true;
      },
      deleteLocalStoreRecordsByKeys: async (_uid: string, store: string, keys: string[]) => {
        const namedBefore = store === 'aiDialogues' ? [...headNamed()] : [];
        if (store === 'aiDialogues') {
          const named = new Set(namedBefore);
          deletedWhileNamed.push(...keys.filter(k => named.has(k)));
        }
        for (const k of keys) cloud.delete(rowKey(store, k));
        if (store === 'aiDialogues') {
          // head называл эти окна, а строк нет — ровно та дырка, из-за которой
          // третий читатель отказывает всему диалогу.
          danglingAfterDelete.push(...namedBefore.filter(k => !cloud.has(rowKey(store, k))));
        }
      },
      deleteLocalStorePagedRecords: async (_uid: string, store: string, key: string) => {
        for (const [k, r] of cloud) if (r.store === store && r.key.startsWith(`${key}#`)) cloud.delete(k);
      },
      deleteLocalStoreRecord: async (_uid: string, store: string, key: string) => {
        const named = headNamed();
        if (named.has(key)) deletedWhileNamed.push(key);
        cloud.delete(rowKey(store, key));
      },
      getUserSummaries: async () => [],
      getUserEmbeddingsPaginated: async () => ({ items: [], nextCursorId: null, readCount: 0 }),
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
vi.mock('../../../shared/errors/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

const BLOB = 'ж'.repeat(95_000);
const DLG_ID = 'dlg_r7q005';

/** Диалог L: два окна — принятое из облака W1 и своё свежее W2. */
function loserDialogue(): AIDialogue {
  return {
    id: DLG_ID,
    title: 'Большой диалог',
    personaId: 'coach',
    personaName: 'Коуч',
    personaEmoji: '🎯',
    createdAt: 1000,
    updatedAt: 2000,
    messages: [
      { id: 'm1', role: 'user', content: `Вопрос один ${BLOB}`, createdAt: 1000 },
      { id: 'm2', role: 'assistant', content: `Ответ один ${BLOB}`, createdAt: 1001 },
      { id: 'm3', role: 'user', content: `Вопрос два ${BLOB}`, createdAt: 1002 },
    ],
  } as unknown as AIDialogue;
}

describe('R7Q-005: проигравший CAS не сносит окна, названные победителем', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cloud.clear();
    deletedWhileNamed.length = 0;
    danglingAfterDelete.length = 0;
    casLosses = 0;
    winnerKeys = [];
    loserKey = '';
    onAfterSavePages = null;
    localStorage.clear();
    resetDbInstance();
  });

  afterEach(() => {
    resetDbInstance();
  });

  it('победитель назвал окно проигравшего — строка остаётся в облаке', async () => {
    const dialogue = loserDialogue();
    const db = await getLocalDb(UID);
    await db.put('aiDialogues', dialogue as never);

    // 1. Осиротевшее окно W1 от оборванной попытки: те же байты, что у первого
    //    окна диалога, head в облаке нет.
    const w1 = `${DLG_ID}@seg1000-orphan1`;
    const w1Messages = JSON.stringify(dialogue.messages.slice(0, 2).map(m => ({ ...m, id: m.id })));
    cloud.set(rowKey('aiDialogues', w1), {
      store: 'aiDialogues',
      key: w1,
      payload: { seg: true, headKey: DLG_ID, firstAt: 1000, lastAt: 1001, updatedAt: 2000, messages: w1Messages },
      stamped_at: Date.now(),
    });

    /** Ссылка head'а на строку — ровно та, что построил бы сам планировщик. */
    const refOf = (key: string) => {
      const p = cloud.get(rowKey('aiDialogues', key))!.payload as { firstAt: number; lastAt: number; updatedAt: number; messages: string };
      return {
        key,
        firstAt: p.firstAt,
        lastAt: p.lastAt,
        updatedAt: p.updatedAt,
        bytes: new TextEncoder().encode(p.messages).length,
        count: (JSON.parse(p.messages) as unknown[]).length,
      };
    };

    // 3. В тот момент, когда L записал свои окна и ещё не поставил head,
    //    просыпается A: он принимает W1 и W2 (байты совпали) и выигрывает CAS.
    //    Head пишется теми же значениями ссылок, что и настоящий планировщик,
    //    чтобы повторная попытка L шла штатным путём, а не чинила несуществующую
    //    копию.
    onAfterSavePages = async (writtenKeys) => {
      expect(writtenKeys.length, 'L записал хотя бы одно свежее окно').toBeGreaterThan(0);
      winnerKeys = [w1, ...writtenKeys];
      loserKey = writtenKeys[0]!;
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
          updatedAt: 5000,
          schema: 2,
          segments: winnerKeys.map(refOf),
        },
        stamped_at: Date.now(),
      });
    };

    LocalStoreSyncService.scheduleStoreSync('aiDialogues', DLG_ID);
    const res = await LocalStoreSyncService.flushPending(true);

    // Холостым тест не должен остаться: проигрыш CAS именно был, и именно он
    // запускает ветку уборки проигравшего.
    expect(res.failed, 'проигрыш CAS — не отказ синхронизации, запись повторится штатно').toBe(0);
    expect(casLosses, 'CAS был проигран — иначе проверка не о чём').toBe(1);
    expect(winnerKeys.length, 'победитель назвал окно, записанное проигравшим').toBe(2);

    // 4. Собственно находка: прежний код сносил «свои» строки, не перечитывая
    // head, и облако оставалось с head'ом на отсутствующее окно. Оба утверждения
    // красные на базе и зелёные с правкой; чтение третьим устройством по
    // недостающему окну закрыто отдельно (dialogueOrphanCleanupRace.t4,
    // dialogueUploadPaged.s49).
    expect(deletedWhileNamed, `проигравший удалил названное окно: ${deletedWhileNamed.join(', ')}`).toEqual([]);
    expect(danglingAfterDelete, `после удаления head ссылается в никуда: ${danglingAfterDelete.join(', ')}`).toEqual([]);
    expect(cloud.has(rowKey('aiDialogues', loserKey)), 'окно проигравшего, принятое победителем, живёт в облаке').toBe(true);
  });
});
