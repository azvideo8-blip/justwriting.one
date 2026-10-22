import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';

/**
 * D1-5: курсор забора ИИ поднимался для каждой ПРОЧИТАННОЙ строки до решений.
 * Отказ (head без окон, слишком большая или битая запись) не откатывал его, и
 * строка больше не приезжала, пока её не перепишут. Курсор обязан двигаться
 * только по применённым группам и не выше самой ранней отвергнутой.
 */

const UID = 'u_d1_5';
const DLG = 'dlg_d1_5';
const SEG = `${DLG}@seg1000-2000`;

const cloud = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  segments: new Map<string, Record<string, unknown>>(),
  fetched: 0,
}));

vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u_d1_5' }) }));
vi.mock('../../../../core/data', () => ({
  DataProvider: new Proxy(
    {
      getLocalStoreRecords: async (_uid: string, _store?: string, sinceMs?: number) => {
        const rows = sinceMs === undefined
          ? cloud.rows
          : cloud.rows.filter(r => typeof r.stamped_at === 'number' && r.stamped_at > sinceMs);
        cloud.fetched += rows.length;
        return rows;
      },
      getLocalStoreRecord: async (_uid: string, _store: string, key: string) => cloud.segments.get(key) ?? null,
    } as Record<string, unknown>,
    { get: (target, prop: string) => (prop in target ? target[prop] : async () => undefined) },
  ),
}));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeDecrypt: async (doc: Record<string, unknown>) => doc,
  maybeEncrypt: async (doc: Record<string, unknown>) => doc,
}));
vi.mock('../../../../core/crypto/encrypt', () => ({ getSessionKey: () => null }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/errors/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('../../utils/embeddingIndexer', () => ({ sha256Hex: async (s: string) => s }));

import { getLocalDb, resetDbInstance } from '../../../../core/storage/localDb';
import { restoreAIDataFromCloud } from '../AIRestoreService';
import { pullSince, nextPullCursor } from '../pullCursor';

const HEAD_STAMP = 2000;
const SEG_STAMP = 2500;
const MEMORY_STAMP = 3000;

const segMessages = JSON.stringify([{ id: 'm1', role: 'user', content: 'синтетическая реплика', at: 1000 }]);

function headRow(): Record<string, unknown> {
  return {
    store: 'aiDialogues',
    key: DLG,
    payload: {
      head: true,
      id: DLG,
      title: '',
      personaId: 'persona',
      personaName: 'Персона',
      personaEmoji: '🙂',
      createdAt: 1000,
      updatedAt: HEAD_STAMP,
      schema: 2,
      segments: [{ key: SEG, firstAt: 1000, lastAt: 2000, updatedAt: SEG_STAMP, bytes: segMessages.length, count: 1 }],
    },
    stamped_at: HEAD_STAMP,
  };
}

function segmentRow(): Record<string, unknown> {
  return {
    store: 'aiDialogues',
    key: SEG,
    payload: { seg: true, headKey: DLG, firstAt: 1000, lastAt: 2000, updatedAt: SEG_STAMP, messages: segMessages },
    stamped_at: SEG_STAMP,
  };
}

function memoryRow(): Record<string, unknown> {
  return {
    store: 'aiChatMemory',
    key: 'mem_d1_5',
    payload: { data: JSON.stringify({ id: 'mem_d1_5', text: 'синтетическая память', updatedAt: MEMORY_STAMP }), updatedAt: MEMORY_STAMP },
    stamped_at: MEMORY_STAMP,
  };
}

beforeEach(async () => {
  resetDbInstance();
  localStorage.clear();
  cloud.rows = [];
  cloud.segments.clear();
  cloud.fetched = 0;
  const db = await getLocalDb(UID);
  await db.clear('aiDialogues');
  await db.clear('aiChatMemory');
});

describe('D1-5: курсор ИИ не перескакивает отвергнутые строки', () => {
  it('head без окон: failed 1, курсор не идёт за его метку; окна доехали — диалог приехал', async () => {
    cloud.rows = [headRow(), memoryRow()];

    const first = await restoreAIDataFromCloud(UID, { sinceMs: pullSince(1000) });

    expect(first.failed, 'оборванная выгрузка отвергнута').toBe(1);
    expect(first.maxUpdatedAt, 'курсор не выше самой ранней отвергнутой строки').toBeLessThan(HEAD_STAMP);
    // Применённая соседняя запись не тянет курсор за отвергнутую.
    expect(first.localStoreRecords, 'память приехала').toBe(1);

    // Следующий проход — с курсором, который вычислил бы фоновой цикл.
    const cursor = nextPullCursor(Date.now(), 1000, first.maxUpdatedAt);
    cloud.segments.set(SEG, segmentRow());
    const second = await restoreAIDataFromCloud(UID, { sinceMs: pullSince(cursor) });

    expect(second.failed).toBe(0);
    const db = await getLocalDb(UID);
    const dialogue = await db.get('aiDialogues', DLG);
    expect(dialogue, 'диалог с окнами приехал').toBeDefined();
    expect((dialogue as { messages?: Array<{ content?: string }> })?.messages?.[0]?.content).toBe('синтетическая реплика');
  });

  it('ревью 0.10.7: порог — самая ранняя строка отвергнутой группы, не самая поздняя', async () => {
    // head (2000) называет два окна; второго нет нигде → отказ. Строка окна (2500)
    // пришла вместе с head, применённая память — между ними (2200).
    const head = headRow();
    const SEG2 = `${DLG}@seg2000-2400`;
    (head.payload as { segments: unknown[] }).segments.push({ key: SEG2, firstAt: 2000, lastAt: 2400, updatedAt: 2400, bytes: 10, count: 1 });
    const mem = memoryRow();
    mem.stamped_at = 2200;
    (mem.payload as { updatedAt: number }).updatedAt = 2200;
    cloud.rows = [head, segmentRow(), mem];

    const res = await restoreAIDataFromCloud(UID, { sinceMs: pullSince(1000) });

    expect(res.failed).toBe(1);
    // По самой поздней (2500) курсор встал бы на 2200 — за head, и следующий
    // построчный забор (`stamped_at > 2200`) принёс бы окно без head.
    expect(res.maxUpdatedAt, 'курсор ниже самой ранней строки группы').toBeLessThan(HEAD_STAMP);
  });

  it('ревью 0.10.7: битая запись (отказ навсегда) курсор не держит', async () => {
    const bad = memoryRow();
    bad.key = 'mem_d1_5_bad';
    bad.stamped_at = 1500;
    bad.payload = { data: '{не json', updatedAt: 1500 };
    cloud.rows = [bad, memoryRow()];

    const res = await restoreAIDataFromCloud(UID, { sinceMs: pullSince(1000) });

    expect(res.failed, 'битая запись посчитана').toBe(1);
    expect(res.maxUpdatedAt, 'курсор идёт дальше битой записи').toBe(MEMORY_STAMP);
  });

  it('DE-2: осиротевший head держит курсор не вечно — потом курсор идёт и забор пустеет', async () => {
    cloud.rows = [headRow(), memoryRow()];
    let cursor = 1000;
    for (let pass = 0; pass < 10 && cursor < MEMORY_STAMP; pass++) {
      const res = await restoreAIDataFromCloud(UID, { sinceMs: pullSince(cursor) });
      cursor = nextPullCursor(Date.now(), cursor, res.maxUpdatedAt);
    }
    expect(cursor, 'курсор ушёл за применённую память').toBeGreaterThanOrEqual(MEMORY_STAMP);

    cloud.fetched = 0;
    await restoreAIDataFromCloud(UID, { sinceMs: pullSince(cursor) });
    expect(cloud.fetched, 'следующий проход ничего не перекачивает').toBe(0);
  });
});
