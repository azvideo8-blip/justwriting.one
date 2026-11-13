import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance } from '../../storage/localDb';
import type { AIDialogue } from '../../storage/localDb';
import { LocalStoreSyncService } from '../LocalStoreSyncService';
import { AIDialogueService } from '../../../features/ai/services/AIDialogueService';
import { restoreAIDataFromCloud } from '../../../features/ai/services/AIRestoreService';
import { buildDocIndex, resolveCited } from '../../../features/ai/components/chat/useCitationMeta';

// Тикет CX-2 (0.11.13): старому ответу (сохранён до CX-1, без таблицы ссылок)
// устройство-автор дозаписывает `citeRefs`, и таблица доезжает до второго
// устройства настоящим путём выгрузки и забора. Обвязка двух устройств — та же,
// что в dialogueMergeUpload.s34: облако — память, синк и забор настоящие.
// Мутации: дозапись ставит existing.updatedAt = Date.now() → красный «updatedAt
// не меняется»; убрать перенос citeRefs из mergePair → красный «параллельный ход».

const UID = 'u_cx2';

type Row = { store: string; key: string; payload: Record<string, unknown> };
const cloud = new Map<string, Row>();
const rowKey = (store: string, key: string) => `${store}:${key}`;
let onCloudRead: (() => void) | null = null;
const casCalls = vi.fn();
/** Что и с каким списком шифруемых полей ушло в облако. */
const encryptCalls: { doc: Record<string, unknown>; fields: string[] }[] = [];

vi.mock('../../data', () => ({
  DataProvider: {
    getLocalStoreRecordsByKeyPrefix: async (_uid: string, store: string, prefix: string) =>
      [...cloud.values()].filter(r => r.store === store && r.key.startsWith(prefix)),
    deleteLocalStoreRecordsByKeys: async (_uid: string, store: string, keys: string[]) => {
      for (const k of keys) cloud.delete(`${store}:${k}`);
    },
    getUserSummaries: async () => [],
    getUserEmbeddingsPaginated: async () => ({ items: [], nextCursorId: null, readCount: 0 }),
    getLocalStoreRecords: async (_uid: string, store?: string, since?: number) =>
      [...cloud.values()].filter(r => (!store || r.store === store) && (since === undefined || Number(r.payload.updatedAt) > since)),
    getLocalStoreRecord: async (_uid: string, store: string, key: string) => {
      const r = cloud.get(rowKey(store, key));
      const out = r ? { store, key, payload: r.payload } : null;
      if (onCloudRead) { const h = onCloudRead; onCloudRead = null; h(); }
      return out;
    },
    saveLocalStoreRecord: async (_uid: string, store: string, key: string, payload: Record<string, unknown>) => {
      cloud.set(rowKey(store, key), { store, key, payload });
    },
    saveLocalStoreRecordIfUnchanged: async (_uid: string, store: string, key: string, payload: Record<string, unknown>, expected: number | null) => {
      casCalls(expected);
      const cur = cloud.get(rowKey(store, key));
      if (expected === null ? cur !== undefined : cur?.payload.updatedAt !== expected) return false;
      cloud.set(rowKey(store, key), { store, key, payload });
      return true;
    },
    deleteLocalStorePagedRecords: async () => {},
    deleteLocalStoreRecord: async (_uid: string, store: string, key: string) => { cloud.delete(rowKey(store, key)); },
  },
}));
vi.mock('../../sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => false }));
vi.mock('../../crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeDecrypt: async (doc: Record<string, unknown>) => doc,
  maybeEncrypt: async (doc: Record<string, unknown>, fields: string[]) => { encryptCalls.push({ doc, fields }); return doc; },
}));
vi.mock('../../crypto/encrypt', () => ({ getSessionKey: () => null }));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../shared/errors/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('../../../features/ai/utils/embeddingIndexer', () => ({ sha256Hex: async (s: string) => s }));
vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: UID, email: 'someone@example.com' }),
  getCurrentUserId: () => UID,
}));

class Device {
  readonly factory = new IDBFactory();
  readonly storage = new Map<string, string>();
}

let currentDevice: Device | null = null;

function switchTo(dev: Device): void {
  if (currentDevice === dev) return;
  if (currentDevice) {
    currentDevice.storage.clear();
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      currentDevice.storage.set(k, localStorage.getItem(k)!);
    }
  }
  localStorage.clear();
  for (const [k, v] of dev.storage) localStorage.setItem(k, v);
  resetDbInstance();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = dev.factory;
  currentDevice = dev;
}

const T = (hhmm: string) => Date.parse(`2026-11-12T${hhmm}:00+05:00`);
function at(hhmm: string): void { vi.setSystemTime(T(hhmm)); }

async function flush(): Promise<void> {
  const r = await LocalStoreSyncService.flushPending(true);
  expect(r.failed, 'выгрузка упала').toBe(0);
}

async function localDialogue(id: string): Promise<AIDialogue> {
  return (await (await getLocalDb()).get('aiDialogues', id)) as AIDialogue;
}

const U = 'uuid-cx2-shared';
const OLD_ANSWER = 'Ты писал об этом [#local_cx2_A].';
const oldAnswer = (d: AIDialogue) => d.messages.find(m => m.content === OLD_ANSWER)!;

async function putNote(id: string): Promise<void> {
  await (await getLocalDb()).put('documents', {
    id, uuid: U, guestId: UID, title: 'Утро', currentVersion: 1, totalWords: 2, totalDuration: 60,
    sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [],
  } as never);
}

/** Старый ответ без таблицы лежит на обоих устройствах; заметка — под своим местным id на каждом. */
async function oldDialogueOnBoth(a: Device, b: Device): Promise<AIDialogue> {
  switchTo(a);
  at('09:00');
  await putNote('local_cx2_A');
  // create() таблицу не считает — так выглядит ответ, сохранённый до CX-1.
  const d = await AIDialogueService.create({
    title: 'Разговор', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
    messages: [{ role: 'user', content: 'Что я писал?' }, { role: 'assistant', content: OLD_ANSWER }],
  });
  await flush();
  switchTo(b);
  at('09:01');
  await putNote('local_cx2_B');
  await restoreAIDataFromCloud(UID);
  expect(oldAnswer(await localDialogue(d.id)).citeRefs).toBeUndefined();
  return d;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  cloud.clear();
  casCalls.mockClear();
  encryptCalls.length = 0;
  onCloudRead = null;
  currentDevice = null;
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('CX-2: дозапись таблицы ссылок у старого ответа', () => {
  it('на авторе таблица появляется, updatedAt диалога и реплики не меняется, второй проход ничего не пишет', async () => {
    const a = new Device();
    const d = await oldDialogueOnBoth(a, new Device());
    switchTo(a);
    at('12:00');
    const before = await localDialogue(d.id);
    const scheduled = vi.spyOn(LocalStoreSyncService, 'scheduleStoreSync');

    await AIDialogueService.backfillCiteRefs(d.id);
    const after = await localDialogue(d.id);
    expect(oldAnswer(after).citeRefs).toEqual({ local_cx2_A: U });
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(oldAnswer(after).updatedAt).toBe(oldAnswer(before).updatedAt);

    at('12:05');
    await AIDialogueService.backfillCiteRefs(d.id);
    expect(await localDialogue(d.id)).toEqual(after);
    expect(scheduled).toHaveBeenCalledTimes(1);
  });

  it('не автор: местного id заметки на устройстве нет — ничего не пишется и в выгрузку не ставится', async () => {
    const b = new Device();
    const d = await oldDialogueOnBoth(new Device(), b);
    switchTo(b);
    const before = await localDialogue(d.id);
    const scheduled = vi.spyOn(LocalStoreSyncService, 'scheduleStoreSync');
    await AIDialogueService.backfillCiteRefs(d.id);
    expect(await localDialogue(d.id)).toEqual(before);
    expect(scheduled).not.toHaveBeenCalled();
  });

  it('уже записанную таблицу не перезаписывает', async () => {
    const a = new Device();
    const d = await oldDialogueOnBoth(a, new Device());
    switchTo(a);
    const db = await getLocalDb();
    const cur = await localDialogue(d.id);
    oldAnswer(cur).citeRefs = { local_cx2_A: 'uuid-written-earlier' };
    await db.put('aiDialogues', cur);
    await AIDialogueService.backfillCiteRefs(d.id);
    expect(oldAnswer(await localDialogue(d.id)).citeRefs).toEqual({ local_cx2_A: 'uuid-written-earlier' });
  });

  it('параллельный ход на B: после выгрузки и забора у B и свой ход, и таблица; ссылка открывает заметку B', async () => {
    const a = new Device();
    const b = new Device();
    const d = await oldDialogueOnBoth(a, b);

    switchTo(a);
    at('12:00');
    await AIDialogueService.backfillCiteRefs(d.id);

    // B успевает дописать ход и выгрузиться раньше A.
    switchTo(b);
    at('12:01');
    await AIDialogueService.appendMessage(d.id, 'Вопрос с B', 'Ответ с B');
    await flush();

    switchTo(a);
    at('12:02');
    await flush();
    // Союз лёг и к A: ход B не потерян, таблица на месте.
    const onA = await localDialogue(d.id);
    expect(onA.messages.map(m => m.content)).toEqual(['Что я писал?', OLD_ANSWER, 'Вопрос с B', 'Ответ с B']);
    expect(oldAnswer(onA).citeRefs).toEqual({ local_cx2_A: U });

    switchTo(b);
    at('12:03');
    await restoreAIDataFromCloud(UID, { sinceMs: T('12:01') });
    const onB = await localDialogue(d.id);
    expect(onB.messages.map(m => m.content)).toEqual(['Что я писал?', OLD_ANSWER, 'Вопрос с B', 'Ответ с B']);
    expect(oldAnswer(onB).citeRefs).toEqual({ local_cx2_A: U });

    const index = await buildDocIndex(await getLocalDb());
    expect(resolveCited(index, 'local_cx2_A', oldAnswer(onB).citeRefs?.local_cx2_A)?.id).toBe('local_cx2_B');
  });

  it('таблица уходит в облако только внутри шифруемого поля', async () => {
    const a = new Device();
    const d = await oldDialogueOnBoth(a, new Device());
    switchTo(a);
    at('12:00');
    await AIDialogueService.backfillCiteRefs(d.id);
    encryptCalls.length = 0;
    await flush();

    const carrying = encryptCalls.filter(c => JSON.stringify(c.doc).includes(U));
    expect(carrying.length, 'таблица не дошла до выгрузки').toBeGreaterThan(0);
    for (const { doc, fields } of carrying) {
      const open = Object.fromEntries(Object.entries(doc).filter(([k]) => !fields.includes(k)));
      expect(JSON.stringify(open), 'uuid заметки или имя поля в открытой части строки').not.toMatch(new RegExp(`${U}|citeRefs|local_cx2_A`));
    }
  });
});
