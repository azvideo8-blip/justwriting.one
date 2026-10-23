import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';

/**
 * Н-2 (дейлик 2026-10-23): отпуск после INCOMPLETE_HOLD_PASSES стоял только на
 * неполном диалоге. Остальные отказы, которые повтор без писателя не исправит
 * (битый сегмент, одиночная строка без текста, страница без текста), держали
 * курсор забора навсегда: каждые 120 с забор заново качал всё новее этой строки.
 * Мутации: отпуск только для `incomplete` → (a) и (b) красные.
 */

const UID = 'u_n2';
const DLG = 'dlg_n2';
const SEG = `${DLG}@seg1000-2000`;
const BAD_STAMP = 2000;
const HOLD_PASSES = 6;

const cloud = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));

vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u_n2' }) }));
vi.mock('../../../../core/data', () => ({
  DataProvider: new Proxy(
    {
      getLocalStoreRecords: async (_uid: string, _store?: string, sinceMs?: number) => sinceMs === undefined
        ? cloud.rows
        : cloud.rows.filter(r => typeof r.stamped_at === 'number' && r.stamped_at > sinceMs),
      getLocalStoreRecord: async () => null,
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
import { pullSince } from '../pullCursor';

const brokenSegmentDialogue = () => [
  {
    store: 'aiDialogues', key: DLG, stamped_at: BAD_STAMP,
    payload: {
      head: true, id: DLG, title: '', personaId: 'p', personaName: 'П', personaEmoji: '🙂',
      createdAt: 1000, updatedAt: BAD_STAMP, schema: 2,
      segments: [{ key: SEG, firstAt: 1000, lastAt: 2000, updatedAt: 1500, bytes: 10, count: 1 }],
    },
  },
  { store: 'aiDialogues', key: SEG, stamped_at: 1900, payload: { seg: true, messages: null } },
];
const singleWithoutText = () => [{ store: 'aiPortrait', key: 'portrait_n2', stamped_at: BAD_STAMP, payload: { updatedAt: BAD_STAMP } }];
// Применимая строка новее отказа: курсору есть куда идти, когда отказ отпущен.
const goodNewer = { store: 'aiChatMemory', key: 'mem_n2', stamped_at: 3000, payload: { updatedAt: 3000, data: JSON.stringify({ id: 'mem_n2', kind: 'fact', text: 'синтетика', createdAt: 3000, updatedAt: 3000 }) } };

const incremental = () => restoreAIDataFromCloud(UID, { sinceMs: pullSince(1000) });

beforeEach(async () => {
  resetDbInstance();
  localStorage.clear();
  const db = await getLocalDb(UID);
  await db.clear('aiDialogues');
  await db.clear('aiChatMemory');
});

describe('Н-2: любой неисправимый отказ отпускает курсор после HOLD_PASSES проходов', () => {
  it.each([
    ['(a) битый сегмент диалога', brokenSegmentDialogue],
    ['(b) одиночная строка без текста', singleWithoutText],
  ])('%s', async (_label, bad) => {
    cloud.rows = [...bad(), goodNewer];
    for (let i = 0; i < HOLD_PASSES; i++) {
      expect((await incremental()).maxUpdatedAt, `проход ${i + 1}: удержан`).toBeLessThan(BAD_STAMP);
    }
    const released = await incremental();
    expect(released.failed, 'отпущенный отказ — не сбой').toBe(0);
    expect(released.maxUpdatedAt, 'курсор пошёл за отпущенную строку').toBe(3000);
  });
});
