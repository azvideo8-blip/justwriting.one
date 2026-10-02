import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance } from '../../storage/localDb';
import type { AIDialogue } from '../../storage/localDb';
import { LocalStoreSyncService } from '../LocalStoreSyncService';
import { AIDialogueService } from '../../../features/ai/services/AIDialogueService';
import { restoreAIDataFromCloud } from '../../../features/ai/services/AIRestoreService';

// S-34: выгрузка диалога — не слепой upsert. Два устройства дописали после
// общего префикса, выгрузились по очереди без забора между ними — в облаке
// должны быть оба хода, а отметка союза — свежая, чтобы инкрементальный забор
// её увидел. Облако здесь — память; путь выгрузки (LocalStoreSyncService) и
// забора (restoreAIDataFromCloud) — настоящие.

const UID = 'u_s34';

type Row = { store: string; key: string; payload: Record<string, unknown> };
const cloud = new Map<string, Row>();
const rowKey = (store: string, key: string) => `${store}:${key}`;
let onCloudRead: (() => void) | null = null;
const casCalls = vi.fn();

vi.mock('../../data', () => ({
  DataProvider: {
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

const T = (hhmm: string) => Date.parse(`2026-10-01T${hhmm}:00+05:00`);
function at(hhmm: string): void { vi.setSystemTime(T(hhmm)); }

async function flush(): Promise<void> {
  const r = await LocalStoreSyncService.flushPending(true);
  expect(r.failed, 'выгрузка упала').toBe(0);
}

function cloudDialogue(id: string): AIDialogue {
  const row = cloud.get(rowKey('aiDialogues', id));
  if (!row) throw new Error('в облаке нет строки диалога');
  return JSON.parse(row.payload.data as string) as AIDialogue;
}

async function localDialogue(id: string): Promise<AIDialogue> {
  return (await (await getLocalDb()).get('aiDialogues', id)) as AIDialogue;
}

const texts = (d: AIDialogue) => d.messages.map(m => m.content);
const PREFIX = ['Общий вопрос', 'Общий ответ'];

/** Общий префикс: A создал и выгрузил, B забрал. */
async function sharedPrefix(a: Device, b: Device): Promise<AIDialogue> {
  switchTo(a);
  at('09:00');
  const d = await AIDialogueService.create({
    title: 'Разговор', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
    messages: [{ role: 'user', content: PREFIX[0]! }, { role: 'assistant', content: PREFIX[1]! }],
  });
  await flush();
  switchTo(b);
  at('09:01');
  await restoreAIDataFromCloud(UID);
  expect(texts(await localDialogue(d.id))).toEqual(PREFIX);
  return d;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  cloud.clear();
  casCalls.mockClear();
  onCloudRead = null;
  currentDevice = null;
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('S-34: dialogue upload merges with the cloud row', () => {
  it('concurrent append on A and B without a pull in between — both turns in the cloud row after each flush', async () => {
    const a = new Device();
    const b = new Device();
    const d = await sharedPrefix(a, b);

    switchTo(b);
    at('09:30');
    await AIDialogueService.appendMessage(d.id, 'Вопрос с B', 'Ответ с B');
    await flush();
    expect(texts(cloudDialogue(d.id))).toEqual([...PREFIX, 'Вопрос с B', 'Ответ с B']);

    switchTo(a);
    at('10:00');
    await AIDialogueService.appendMessage(d.id, 'Вопрос с A', 'Ответ с A');
    await flush();

    const inCloud = texts(cloudDialogue(d.id));
    expect(inCloud, `ход B затёрт выгрузкой A: ${JSON.stringify(inCloud)}`)
      .toEqual([...PREFIX, 'Вопрос с B', 'Ответ с B', 'Вопрос с A', 'Ответ с A']);
    // A слил союз и к себе — иначе следующая правка на A снова выгрузит половинку.
    expect(texts(await localDialogue(d.id))).toEqual(inCloud);
  });

  it('cloud changed between read and write — compare-and-swap fails, merge retried, nothing lost', async () => {
    const a = new Device();
    const b = new Device();
    const d = await sharedPrefix(a, b);

    switchTo(b);
    at('09:30');
    await AIDialogueService.appendMessage(d.id, 'Вопрос с B', 'Ответ с B');
    const bRecord = await localDialogue(d.id);

    switchTo(a);
    at('10:00');
    await AIDialogueService.appendMessage(d.id, 'Вопрос с A', 'Ответ с A');
    // Пока A читает облако, туда садится выгрузка B.
    onCloudRead = () => {
      cloud.set(rowKey('aiDialogues', d.id), {
        store: 'aiDialogues', key: d.id,
        payload: { data: JSON.stringify(bRecord), updatedAt: bRecord.updatedAt },
      });
    };
    casCalls.mockClear();
    await flush();

    const inCloud = texts(cloudDialogue(d.id));
    expect(inCloud, `ход B затёрт: ${JSON.stringify(inCloud)}`)
      .toEqual([...PREFIX, 'Вопрос с B', 'Ответ с B', 'Вопрос с A', 'Ответ с A']);
    expect(casCalls.mock.calls.length, 'условная запись не повторилась после конфликта').toBe(2);
  });

  it('merged record uploads with updatedAt = now, so the incremental pull on the other device sees it', async () => {
    const a = new Device();
    const b = new Device();
    const d = await sharedPrefix(a, b);

    // B пишет в 09:30 и уходит в офлайн (не выгружается).
    switchTo(b);
    at('09:30');
    await AIDialogueService.appendMessage(d.id, 'Вопрос с B', 'Ответ с B');

    // A пишет в 10:00, выгружается и забирает инкрементально в 10:05.
    switchTo(a);
    at('10:00');
    await AIDialogueService.appendMessage(d.id, 'Вопрос с A', 'Ответ с A');
    await flush();
    at('10:05');
    await restoreAIDataFromCloud(UID, { sinceMs: T('09:02') });

    // B вернулся в 12:00: союз уходит в облако с отметкой 12:00, не 10:00.
    switchTo(b);
    at('12:00');
    await flush();
    expect(texts(cloudDialogue(d.id))).toEqual([...PREFIX, 'Вопрос с B', 'Ответ с B', 'Вопрос с A', 'Ответ с A']);
    expect(cloudDialogue(d.id).updatedAt, 'отметка союза не поднята').toBe(T('12:00'));

    // A забирает «изменённое после 10:05» в 12:05 — и видит ход B.
    switchTo(a);
    at('12:05');
    await restoreAIDataFromCloud(UID, { sinceMs: T('10:05') });
    const onA = texts(await localDialogue(d.id));
    expect(onA, `инкрементальный забор не увидел союз: ${JSON.stringify(onA)}`).toContain('Вопрос с B');
  });

  it('S-57: a merge during upload that changes the local record dispatches dialogue-updated; an unchanged one does not', async () => {
    const a = new Device();
    const b = new Device();
    const d = await sharedPrefix(a, b);

    switchTo(b);
    at('09:30');
    await AIDialogueService.appendMessage(d.id, 'Вопрос с B', 'Ответ с B');
    await flush();

    switchTo(a);
    at('10:00');
    await AIDialogueService.appendMessage(d.id, 'Вопрос с A', 'Ответ с A');
    const updated = vi.fn();
    window.addEventListener('dialogue-updated', updated);
    try {
      await flush();
      expect(updated, 'открытый чат не узнал о слитом ходе B').toHaveBeenCalledTimes(1);
      // Повторная выгрузка без изменений — без события.
      LocalStoreSyncService.scheduleStoreSync('aiDialogues', d.id);
      await flush();
      expect(updated).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('dialogue-updated', updated);
    }
  });

  it('S-53 survivor: the first upload of a dialogue carries schema 2 even without a cloud copy to merge with', async () => {
    const a = new Device();
    switchTo(a);
    at('09:00');
    const d = await AIDialogueService.create({
      title: 'Разговор', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
      messages: [{ role: 'user', content: 'Вопрос' }, { role: 'assistant', content: 'Ответ' }],
    });
    await flush();
    expect(cloudDialogue(d.id).schema, 'без маркера схемы второе устройство примет запись за старый клиент').toBe(2);
  });

  it('S-45/S-29: a union produced by the restore merge is queued and reaches the cloud', async () => {
    const a = new Device();
    const b = new Device();
    const d = await sharedPrefix(a, b);

    switchTo(a);
    at('09:30');
    await AIDialogueService.appendMessage(d.id, 'Вопрос с A', 'Ответ с A');
    await flush();
    switchTo(b);
    at('09:31');
    await restoreAIDataFromCloud(UID);
    expect(texts(await localDialogue(d.id))).toContain('Вопрос с A');

    // Старый клиент перезаписал облако своей копией без хода A.
    const stale = JSON.parse(JSON.stringify(await localDialogue(d.id))) as AIDialogue;
    stale.messages = stale.messages.filter(m => !m.content.includes(' с A'));
    stale.messages.push({ role: 'user', content: 'Вопрос со старого' }, { role: 'assistant', content: 'Ответ со старого' });
    stale.updatedAt = T('10:00');
    cloud.set(rowKey('aiDialogues', d.id), { store: 'aiDialogues', key: d.id, payload: { data: JSON.stringify(stale), updatedAt: stale.updatedAt } });

    at('10:30');
    await restoreAIDataFromCloud(UID);
    await flush();

    const inCloud = texts(cloudDialogue(d.id));
    expect(inCloud, `союз после слияния не доехал до облака: ${JSON.stringify(inCloud)}`).toContain('Вопрос с A');
    expect(inCloud).toContain('Вопрос со старого');
  });
});
