import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';

/**
 * R-8 (ревью 2026-10-22, вторая половина DE-2): осиротевший head давал `failed++`
 * каждый проход — и после отпуска тоже, так что суточная отметка полного прохода
 * не ставилась никогда, а каждые 120 с шёл полный restoreAIDataFromCloud.
 * Отпущенный head — не сбой.
 *
 * C7 (ревью фазы A): счётчик переписывался целиком каждым проходом. Отпущенный
 * head, который инкрементальный забор уже не видит (курсор за ним), выпадал — и
 * назавтра полный проход начинал счёт с нуля: снова `failed++` каждые 120 с.
 * И head старше окна забора видит только полный проход, а он не считал вовсе.
 * Теперь считают оба прохода, отпущенный помнится.
 *
 * Мутации: безусловный `result.failed++` → (a) красный; считать только
 * инкрементальный → (b) красный; не переносить отпущенные → (c) красный;
 * переносить и неотпущенные → (d) красный;
 * лимит держит хвост (`slice(-CAP)`) → (e) красный.
 */

const UID = 'u_r8';
const DLG = 'dlg_r8';
const SEG = `${DLG}@seg1000-2000`;

const cloud = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));

vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u_r8' }) }));
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

const HEAD_STAMP = 2000;
const HOLD_PASSES = 6;

function orphanHead(): Record<string, unknown> {
  return {
    store: 'aiDialogues',
    key: DLG,
    payload: {
      head: true, id: DLG, title: '', personaId: 'p', personaName: 'П', personaEmoji: '🙂',
      createdAt: 1000, updatedAt: HEAD_STAMP, schema: 2,
      segments: [{ key: SEG, firstAt: 1000, lastAt: 2000, updatedAt: 1500, bytes: 10, count: 1 }],
    },
    stamped_at: HEAD_STAMP,
  };
}

const incremental = () => restoreAIDataFromCloud(UID, { sinceMs: pullSince(1000) });
const full = () => restoreAIDataFromCloud(UID);

beforeEach(async () => {
  resetDbInstance();
  localStorage.clear();
  cloud.rows = [orphanHead()];
  const db = await getLocalDb(UID);
  await db.clear('aiDialogues');
});

describe('R-8: осиротевший head после отпуска — не сбой прохода', () => {
  it('(a) держит HOLD_PASSES инкрементальных проходов с failed=1, потом failed=0 и курсор идёт', async () => {
    for (let i = 0; i < HOLD_PASSES; i++) {
      const held = await incremental();
      expect(held.failed, `проход ${i + 1}: head удержан`).toBe(1);
      expect(held.maxUpdatedAt).toBeLessThan(HEAD_STAMP);
    }
    const released = await incremental();
    expect(released.failed, 'отпущенный head — не сбой').toBe(0);
    const again = await incremental();
    expect(again.failed).toBe(0);
  });

  it('(b) head старше окна забора: его видит только полный проход — и он тоже считает', async () => {
    for (let i = 0; i < HOLD_PASSES; i++) {
      expect((await full()).failed, `полный проход ${i + 1}: удержан`).toBe(1);
    }
    expect((await full()).failed, 'отпущен после HOLD_PASSES полных').toBe(0);
  });

  it('(c) отпущенный head, которого инкрементальный уже не видит, назавтра не возвращается в сбой', async () => {
    for (let i = 0; i < HOLD_PASSES; i++) await incremental();
    expect((await incremental()).failed, 'отпущен').toBe(0);
    expect((await full()).failed, 'полный в тот же день').toBe(0);
    // Курсор ушёл за head: инкрементальный забор его больше не приносит.
    expect((await restoreAIDataFromCloud(UID, { sinceMs: HEAD_STAMP })).failed).toBe(0);
    expect((await full()).failed, 'назавтра полный проход — head всё ещё отпущен').toBe(0);
  });

  it('(e) при 200 давно отпущенных свежеотпущенный head не вытесняется', async () => {
    const old: Record<string, number> = {};
    for (let i = 0; i < 200; i++) old[`aiDialogues:old_${i}:1`] = HOLD_PASSES + 1;
    localStorage.setItem(`ai_incomplete_holds_${UID}`, JSON.stringify(old));
    for (let i = 0; i < HOLD_PASSES; i++) await incremental();
    expect((await incremental()).failed, 'отпущен').toBe(0);
    await restoreAIDataFromCloud(UID, { sinceMs: HEAD_STAMP });
    expect((await full()).failed, 'свежий отпущенный помнится, вытеснен самый старый').toBe(0);
  });

  it('(d) неотпущенный head, который проход не увидел (починен), из счётчика выпадает', async () => {
    await incremental();
    await incremental();
    cloud.rows = [];
    await full();
    cloud.rows = [orphanHead()];
    for (let i = 0; i < HOLD_PASSES; i++) {
      expect((await full()).failed, `счёт с нуля, проход ${i + 1}`).toBe(1);
    }
  });
});
