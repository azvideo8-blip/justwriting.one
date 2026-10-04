import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance } from '../../storage/localDb';
import type { AIDialogue } from '../../storage/localDb';
import { LocalStoreSyncService } from '../LocalStoreSyncService';
import { AIDialogueService } from '../../../features/ai/services/AIDialogueService';

// Серверная метка, шаг 2 (миграция 0037): базовой строке диалога отметку версии
// ставит сервер, а локальная копия обязана её принять. Без принятия device-часы
// снова выигрывают следующий спор скаляров — ровно тот механизм, из-за которого
// устройство с часами вперёд держало чужие настройки замороженными сутки
// (ag-clock-skew-scalar-hostage-ticket.md).
//
// Мутация, доказывающая смысл: убрать вызов adoptServerStamp в LocalStoreSyncService —
// тесты 1 и 3 краснеют (локальная копия остаётся со своим будущим временем).

const UID = 'u_stamp';
const DAY = 86_400_000;
/** «Серверные часы» — то, что триггер ставит вместо клиентского updatedAt. */
const SERVER_NOW = 1_790_000_000_000;

type Row = { store: string; key: string; payload: Record<string, unknown> };
const cloud = new Map<string, Row>();
const rowKey = (store: string, key: string) => `${store}:${key}`;
const ops: string[] = [];

/** Та же перепись, что делает триггер миграции 0037: только базовая строка
 *  диалога, только если updatedAt уже число. Дочерние (`#`, `@`) — целы. */
function stampRow(store: string, key: string, payload: Record<string, unknown>): Record<string, unknown> {
  if (store === 'aiDialogues' && !key.includes('#') && !key.includes('@') && typeof payload.updatedAt === 'number') {
    return { ...payload, updatedAt: SERVER_NOW };
  }
  return payload;
}

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
      ops.push(`save:${key}`);
      cloud.set(rowKey(store, key), { store, key, payload: stampRow(store, key, payload) });
    },
    saveLocalStoreRecordPages: async (_uid: string, store: string, pages: Array<{ key: string; payload: Record<string, unknown> }>) => {
      ops.push(`pages:${pages.length}`);
      for (const p of pages) cloud.set(rowKey(store, p.key), { store, key: p.key, payload: stampRow(store, p.key, p.payload) });
    },
    saveLocalStoreRecordIfUnchanged: async (_uid: string, store: string, key: string, payload: Record<string, unknown>, expected: number | null) => {
      ops.push(`cas:${key}`);
      const cur = cloud.get(rowKey(store, key));
      if (expected === null ? cur !== undefined : cur?.payload.updatedAt !== expected) return false;
      cloud.set(rowKey(store, key), { store, key, payload: stampRow(store, key, payload) });
      return true;
    },
    deleteLocalStorePagedRecords: async (_uid: string, store: string, key: string) => {
      for (const [k, r] of cloud) if (r.store === store && r.key.startsWith(`${key}#`)) cloud.delete(k);
    },
    deleteLocalStoreRecord: async (_uid: string, store: string, key: string) => {
      cloud.delete(rowKey(store, key));
      for (const [k, r] of cloud) if (r.store === store && (r.key.startsWith(`${key}#`) || r.key.startsWith(`${key}@`))) cloud.delete(k);
    },
  },
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
vi.mock('../../../features/ai/utils/embeddingIndexer', () => ({ sha256Hex: async (s: string) => s }));
vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: UID, email: 'someone@example.com' }),
  getCurrentUserId: () => UID,
}));

async function local(id: string): Promise<AIDialogue | undefined> {
  return (await getLocalDb()).get('aiDialogues', id) as Promise<AIDialogue | undefined>;
}

async function flush(): Promise<{ synced: number; failed: number }> {
  const r = await LocalStoreSyncService.flushPending(true);
  expect(r.failed, 'выгрузка упала').toBe(0);
  return r;
}

beforeEach(async () => {
  // Подменяем только Date: fake-indexeddb иочные задержки живут на настоящих таймерах.
  vi.useFakeTimers({ toFake: ['Date'] });
  // Устройство живёт на сутки вперёд — ровно тот случай, который ломал слияние.
  vi.setSystemTime(SERVER_NOW + DAY);
  cloud.clear();
  ops.length = 0;
  localStorage.clear();
  resetDbInstance();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  await (await getLocalDb()).clear('aiDialogues');
});

afterEach(() => { vi.useRealTimers(); });

describe('серверная метка: локальная копия принимает серверную отметку версии', () => {
  it('после выгрузки updatedAt локальной копии равен серверному, а не часам устройства', async () => {
    const d = await AIDialogueService.create({
      title: 'Разговор', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
      messages: [{ role: 'user', content: 'Вопрос' }, { role: 'assistant', content: 'Ответ' }],
    });
    const deviceStamp = d.updatedAt;
    expect(deviceStamp).toBeGreaterThan(SERVER_NOW); // устройство спешит на сутки

    await flush();

    const row = cloud.get(rowKey('aiDialogues', d.id))!;
    expect(row.payload.updatedAt, 'сервер не переписал отметку базовой строки').toBe(SERVER_NOW);
    const after = await local(d.id);
    expect(after!.updatedAt, 'локальная копия осталась с часами устройства').toBe(SERVER_NOW);
  });

  it('принятие метки не поднимает повторную выгрузку: второй флеш ничего не пишет', async () => {
    const d = await AIDialogueService.create({
      title: 'Разговор', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
      messages: [{ role: 'user', content: 'Вопрос' }, { role: 'assistant', content: 'Ответ' }],
    });
    await flush();
    const key = `save:${d.id}`;
    const writes = ops.filter(o => o === key || o === `cas:${d.id}`).length;
    expect(writes, 'первая выгрузка не дошла до облака').toBe(1);

    await flush();

    expect(ops.filter(o => o === key || o === `cas:${d.id}`).length, 'повторная выгрузка того же содержимого')
      .toBe(writes);
    expect((await local(d.id))!.updatedAt, 'после второго флеша локальная метка съехала').toBe(SERVER_NOW);
  });

  it('сегментная ветка: после подписания head’а локальная копия тоже принимает метку', async () => {
    const BIG = 'ы'.repeat(95_000);
    const d = await AIDialogueService.create({
      title: 'Большой', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
      messages: [{ role: 'user', content: `Вопрос ${BIG}${BIG}${BIG}` }, { role: 'assistant', content: 'Ответ' }],
    });
    await flush();

    const row = cloud.get(rowKey('aiDialogues', d.id))!;
    expect(row.payload.head, 'строк больше строки, а head’а нет').toBe(true);
    expect(row.payload.updatedAt).toBe(SERVER_NOW);
    const after = await local(d.id);
    expect(after!.updatedAt, 'head переписан сервером, а локальная копия — своими часами').toBe(SERVER_NOW);
    // Окна-сегменты сервер не трогает: по их отметке строится уборка прежней копии.
    const seg = [...cloud.values()].find(r => r.key.includes('@seg'))!;
    expect(typeof seg.payload.updatedAt).toBe('number');
  });
});
