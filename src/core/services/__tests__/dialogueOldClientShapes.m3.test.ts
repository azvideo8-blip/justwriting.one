import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { oldClientWrites, type Row } from './helpers/oldClientRestore029';
import { pageTextOf, parseLocalStoreKey, selectCloudVersion } from '../localStorePages';
import { readSegmentVersion } from '../dialogueSegments';
import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance } from '../../storage/localDb';
import type { AIDialogue } from '../../storage/localDb';
import { LocalStoreSyncService } from '../LocalStoreSyncService';
import { AIDialogueService } from '../../../features/ai/services/AIDialogueService';

// M-3 (ag-tickets-2026-10-02-merge-and-crisis.md): клиенты 0.9.28 и 0.9.29 обязаны
// НЕ понимать новый формат страниц. Ниже — порт их read-пути, а не пересказ:
// main:src/features/ai/services/AIRestoreService.ts (файл байт-идентичен в 8eeb52cf
// и d9e6378f), строки 194–221 (разбор ключа и группировка), 226–235 (unpaged),
// 236–282 (сборка версии по payload.updatedAt/totalPages), 293–300 (расшифровка
// страниц), 358–389 (сравнение отметок и db.put).
//
// Опасность была в том, что их парсер режет ключ по ПОСЛЕДНЕЙ «#»: новые страницы
// `key#<stamp>#<nonce>#<i>` группировались в baseKey `key#<stamp>#<nonce>`, локальной
// записи с таким ключом нет → ветка «локала нет» → БЕЗ сравнения отметок диалог
// клался в IndexedDB по своему `id`, то есть затирал несохранённые ходы старого
// клиента. Поэтому у страницы теперь непригодно-цифровой хвост (`#p<i>`) и текст в
// `chunk`: строка без `data` старым читателем просто пропускается.

const ID = 'd-11111111-2222-3333-4444-555555555555';
const STAMP = 1_759_000_000_000;
const NONCE = 'aabbccdd';

/** Диалог, который старый клиент положил бы в облако страницами прежней формы. */
function legacyShape(dialogue: AIDialogue): Row[] {
  const json = JSON.stringify(dialogue);
  const half = Math.ceil(json.length / 2);
  return [
    { key: `${ID}#${STAMP}#0`, payload: { data: json.slice(0, half), updatedAt: STAMP, page: 0, totalPages: 2 } },
    { key: `${ID}#${STAMP}#1`, payload: { data: json.slice(half), updatedAt: STAMP, page: 1, totalPages: 2 } },
    { key: ID, payload: { manifest: true, updatedAt: STAMP, totalPages: 2 } },
  ].map(r => ({ store: 'aiDialogues', ...r }));
}

/** Тот же диалог в новом формате M-2/M-3: метка попытки, `#p<N>`, текст в `chunk`. */
function newShape(dialogue: AIDialogue): Row[] {
  const json = JSON.stringify(dialogue);
  const half = Math.ceil(json.length / 2);
  return [
    { key: `${ID}#${STAMP}#${NONCE}#p0`, payload: { chunk: json.slice(0, half), updatedAt: STAMP, page: 0, totalPages: 2, nonce: NONCE } },
    { key: `${ID}#${STAMP}#${NONCE}#p1`, payload: { chunk: json.slice(half), updatedAt: STAMP, page: 1, totalPages: 2, nonce: NONCE } },
    { key: ID, payload: { manifest: true, updatedAt: STAMP, totalPages: 2, nonce: NONCE } },
  ].map(r => ({ store: 'aiDialogues', ...r }));
}

const cloudDialogue: AIDialogue = {
  id: ID,
  title: 'Облако',
  personaId: 'p',
  personaName: 'P',
  personaEmoji: '🎯',
  messages: [
    { id: 'm1', role: 'user', content: 'Вопрос из облака', createdAt: STAMP - 20 },
    { id: 'm2', role: 'assistant', content: 'Ответ из облака', createdAt: STAMP - 10 },
  ],
  createdAt: STAMP - 20,
  updatedAt: STAMP,
  schema: 2,
};

// Локальная копия старого клиента: свой несохранённый ход и более свежая отметка.
const oldLocal: AIDialogue = {
  ...cloudDialogue,
  title: 'Локаль',
  messages: [...cloudDialogue.messages, { id: 'm3', role: 'user', content: 'Мой несохранённый ход', createdAt: STAMP + 1 }],
  updatedAt: STAMP + 5,
};

const localById = new Map<string, AIDialogue>([[ID, oldLocal]]);

describe('M-3: клиенты 0.9.28/0.9.29 не понимают новый формат страниц', () => {
  it('новый формат: старое чтение НЕ трогает локальный диалог', () => {
    const writes = oldClientWrites(newShape(cloudDialogue), localById);
    expect(writes.map(w => w.baseKey), `старый клиент хочет записать ${JSON.stringify(writes.map(w => w.baseKey))}`).toEqual([]);
  });

  it('ловушка: прежняя форма (data + ключ без «p») локальный диалог затирала', () => {
    const writes = oldClientWrites(legacyShape(cloudDialogue), localById);
    // Ровно то, из-за чего M-3 существует: baseKey «id#stamp» локально отсутствует →
    // ветка «локала нет» → put без сравнения отметок, и облачная копия ложится поверх
    // несохранённого хода.
    expect(writes.length).toBe(1);
    expect(writes[0]!.baseKey).toBe(`${ID}#${STAMP}`);
    expect(writes[0]!.dialogue.messages.map(m => m.id)).toEqual(['m1', 'm2']);
  });

  it('манифест строкой `key` старый читатель и раньше пропускал (нет `data`)', () => {
    const writes = oldClientWrites([{ store: 'aiDialogues', key: ID, payload: { manifest: true, updatedAt: STAMP, totalPages: 2, nonce: NONCE } }], localById);
    expect(writes).toEqual([]);
  });

  it('новый клиент свои страницы читает: форма не «для прочности», а рабочая', () => {
    const rows = newShape(cloudDialogue);
    const version = selectCloudVersion(rows);
    if (version === null || version.kind !== 'pages') { expect.fail('свои страницы не прочитались'); return; }
    let text = '';
    for (const page of version.pages) {
      const chunk = pageTextOf(page.payload);
      expect(typeof chunk).toBe('string');
      text += chunk ?? '';
    }
    expect(JSON.parse(text) as AIDialogue).toEqual(cloudDialogue);
    // …и чужой nonce той же отметки в эту версию не попадает.
    const foreign = { store: 'aiDialogues', key: `${ID}#${STAMP}#deadbeef#p1`, payload: { chunk: 'чужая попытка', updatedAt: STAMP, page: 1, totalPages: 2, nonce: 'deadbeef' } };
    const v2 = selectCloudVersion([...rows, foreign]);
    if (v2 === null || v2.kind !== 'pages') { expect.fail('чужой nonce попал в версию'); return; }
    expect(v2.pages.length).toBe(2);
  });

  it('ключ новой страницы не разбирается старым парсером как страница', () => {
    const key = `${ID}#${STAMP}#${NONCE}#p1`;
    // Наш парсер — понимает.
    expect(parseLocalStoreKey(key)).toEqual({ baseKey: ID, stamp: STAMP, nonce: NONCE, pageIndex: 1 });
    // Их — нет: хвост не цифры, значит вся строка считается отдельной записью.
    const hashIdx = key.lastIndexOf('#');
    expect(/^[0-9A-Fa-f]*$/.test(key.slice(hashIdx + 1))).toBe(false);
    expect(/^\d+$/.test(key.slice(hashIdx + 1))).toBe(false);
  });
});

// S-49: диалог крупнее одной страницы (> 500 КБ) лежит в облаке страницами.
// Выгрузка читала только строку `key`, страницы читались как «строки нет»:
// устройство вставляло свою копию без хода другого и сносило его страницы.
// Облако здесь — память с теми же операциями, что у провайдера (строка `key`,
// страницы `key#…`, условная запись); выгрузка и забор — настоящие.

const UID = 'u_s49';

const cloud = new Map<string, Row>();
const rowKey = (store: string, key: string) => `${store}:${key}`;
let onCloudRead: (() => void) | null = null;
const casCalls = vi.fn();

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
      return r ? { store, key, payload: r.payload } : null;
    },
    getLocalStoreRecordPages: async (_uid: string, store: string, key: string) => {
      const out = [...cloud.values()].filter(r => r.store === store && r.key.startsWith(`${key}#`));
      // Срабатывает после обоих чтений: строки и страниц.
      if (onCloudRead) { const h = onCloudRead; onCloudRead = null; h(); }
      return out;
    },
    saveLocalStoreRecord: async (_uid: string, store: string, key: string, payload: Record<string, unknown>) => {
      cloud.set(rowKey(store, key), { store, key, payload });
    },
    saveLocalStoreRecordPages: async (_uid: string, store: string, pages: Array<{ key: string; payload: Record<string, unknown> }>) => {
      for (const p of pages) cloud.set(rowKey(store, p.key), { store, key: p.key, payload: p.payload });
    },
    saveLocalStoreRecordIfUnchanged: async (_uid: string, store: string, key: string, payload: Record<string, unknown>, expected: number | null) => {
      casCalls(expected);
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
      for (const [k, r] of cloud) if (r.store === store && r.key.startsWith(`${key}#`)) cloud.delete(k);
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

const T = (hhmm: string) => Date.parse(`2026-10-02T${hhmm}:00+05:00`);
function at(hhmm: string): void { vi.setSystemTime(T(hhmm)); }

async function flush(): Promise<void> {
  const r = await LocalStoreSyncService.flushPending(true);
  expect(r.failed, 'выгрузка упала').toBe(0);
  expect(r.skippedOversized, 'запись сочтена слишком большой').toBe(0);
}

async function localDialogue(id: string): Promise<AIDialogue> {
  return (await (await getLocalDb()).get('aiDialogues', id)) as AIDialogue;
}

/** Реплики диалога без длинных тел — по первым словам. */
const cloudKeys = (id: string) => [...cloud.values()].filter(r => r.key === id || r.key.startsWith(`${id}#`) || r.key.startsWith(`${id}@seg`)).map(r => r.key);

// appendMessage режет реплику и рассуждение по 100 000 знаков; три таких куска
// (вопрос, ответ, рассуждение) — ~570 КБ в UTF-8, больше порога страницы (500 КБ).
const BIG = 'ы'.repeat(95_000);

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




// ── M-3, настоящая выгрузка ───────────────────────────────────────────
// Тот же стенд, что в dialoguePagedNoManifest.m1.test.ts: облако — память с
// операциями провайдера, выгрузка — настоящий LocalStoreSyncService. Строки,
// которые она кладёт в облако, скармливаются портированному читателю 0.9.29:
// тот не должен собрать из них диалог и положить в локальную базу. Красный на
// ba5bbf59 (до M-3): ключ `key#<stamp>#<nonce>#<i>` старый парсер резал по
// последней «#», собирал версию из `data` и писал её без сравнения отметок.
describe('M-3: строки сегодняшней выгрузки старый клиент не читают', () => {
  it('постраничный диалог не ложится поверх локальной копии 0.9.29', async () => {
    const a = new Device();
    switchTo(a);
    at('09:00');
    const d = await AIDialogueService.create({
      title: 'Разговор', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
      messages: [{ role: 'user', content: 'Вопрос' }, { role: 'assistant', content: 'Ответ' }],
    });
    await flush();
    // appendMessage режет реплику и рассуждение по 100 000 знаков: три куска
    // (вопрос, ответ, рассуждение) — ~570 КБ в UTF-8, за порогом страницы.
    await AIDialogueService.appendMessage(d.id, 'Большой вопрос ' + BIG, 'Большой ответ ' + BIG, BIG);
    await flush();
    expect(cloudKeys(d.id).some(k => k.includes('@seg')), 'диалог не ушёл сегментами').toBe(true);

    const rows: Row[] = [...cloud.values()];
    // Локальная копия старого клиента — со своим несохранённым ходом.
    const localCopy = {
      ...(await localDialogue(d.id)),
      messages: [{ id: 'x1', role: 'user', content: 'мой несохранённый ход' }],
    } as AIDialogue;
    const writes = oldClientWrites(rows, new Map([[d.id, localCopy]]));
    expect(writes.map(w => w.baseKey), `старый клиент собирает и пишет: ${JSON.stringify(writes.map(w => w.baseKey))}`).toEqual([]);

    // Для верности: наш читатель эти же строки собирает, и форма не «для прочности».
    const version = readSegmentVersion(rows.map(r => ({ key: r.key, payload: r.payload })));
    if (version === null || version.kind !== 'segments') { expect.fail('новый читатель не видит свои сегменты'); return; }
    expect(version.dialogue.messages).toHaveLength(4);
  });
});
