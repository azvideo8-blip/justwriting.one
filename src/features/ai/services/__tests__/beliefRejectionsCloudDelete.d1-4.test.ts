import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';

/**
 * D1-4: `aiBeliefRejections` — синхронизируемый стор, но и кольцевой буфер, и
 * `clearRejections()` чистили только IndexedDB. Забор возвращал строки обратно,
 * а `collectCandidateUnits` по этим id вечно запрещал пересмотр единиц.
 * Удаление обязано доехать до облака, как у соседнего `aiChatMemory`.
 */

const UID = 'u_d1_4';
const cloud = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock('../../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: 'u_d1_4' }),
  getCurrentUserId: () => 'u_d1_4',
}));
vi.mock('../../../../core/data', () => ({
  DataProvider: new Proxy(
    {
      getLocalStoreRecords: async () => cloud.rows,
      deleteLocalStoreRecord: async () => {},
    } as Record<string, unknown>,
    { get: (target, prop: string) => (prop in target ? target[prop] : async () => undefined) },
  ),
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { getLocalDb } from '../../../../core/storage/localDb';
import { getPendingStoreDeleteKeys } from '../../../../core/services/LocalStoreSyncService';
import { AIConsolidationService, type RejectedBeliefRecord } from '../AIConsolidationService';
import { restoreAIDataFromCloud } from '../AIRestoreService';

const rejection = (id: string, timestamp: number): RejectedBeliefRecord => ({
  id,
  timestamp,
  clusterSize: 2,
  firstSeenAt: '2026-10-01',
  reason: 'синтетическая причина',
  kind: 'judge_rejected',
  rewriteAttempted: false,
  rejectedTextSnippet: 'синтетический фрагмент',
  unitIds: [`unit_${id}`],
});

const cloudRow = (id: string, timestamp: number): Record<string, unknown> => ({
  store: 'aiBeliefRejections',
  key: id,
  payload: { data: JSON.stringify(rejection(id, timestamp)), updatedAt: timestamp },
  stamped_at: timestamp,
});

beforeEach(async () => {
  localStorage.clear();
  cloud.rows = [];
  const db = await getLocalDb(UID);
  await db.clear('aiBeliefRejections');
});

describe('D1-4: удаления журнала отказов доезжают до облака', () => {
  it('clearRejections ставит в журнал удаление на каждую строку', async () => {
    const db = await getLocalDb(UID);
    await db.put('aiBeliefRejections', rejection('rej_1', 1000) as never);
    await db.put('aiBeliefRejections', rejection('rej_2', 2000) as never);
    await db.put('aiBeliefRejections', rejection('rej_3', 3000) as never);

    await AIConsolidationService.clearRejections();

    const pending = getPendingStoreDeleteKeys(UID);
    expect(pending?.has('aiBeliefRejections:rej_1')).toBe(true);
    expect(pending?.has('aiBeliefRejections:rej_2')).toBe(true);
    expect(pending?.has('aiBeliefRejections:rej_3')).toBe(true);
    expect(await db.getAll('aiBeliefRejections')).toEqual([]);
  });

  it('облачные строки, удалённые кнопкой, не возвращаются забором', async () => {
    const db = await getLocalDb(UID);
    await db.put('aiBeliefRejections', rejection('rej_1', 1000) as never);
    await db.put('aiBeliefRejections', rejection('rej_2', 2000) as never);
    cloud.rows = [cloudRow('rej_1', 1000), cloudRow('rej_2', 2000), cloudRow('rej_9', 3000)];
    await AIConsolidationService.clearRejections();

    const res = await restoreAIDataFromCloud(UID);

    const left = await db.getAll('aiBeliefRejections');
    expect(left.map(r => r.id), 'отказ, удалённый человеком, не воскрес').toEqual(['rej_9']);
    expect(res.localStoreRecords, 'обычная облачная строка приезжает, заглушена только удалённая').toBe(1);
  });

  it('вытеснение кольцевого буфера тоже ставит удаление', async () => {
    const db = await getLocalDb(UID);
    for (let i = 0; i < 200; i++) {
      await db.put('aiBeliefRejections', rejection(`rej_${i}`, 1000 + i) as never);
    }

    await AIConsolidationService.saveRejection(rejection('rej_new', 9999));

    const pending = getPendingStoreDeleteKeys(UID);
    expect(pending?.has('aiBeliefRejections:rej_0'), 'самая старая строка вытеснена и удаление уехало').toBe(true);
    expect(await db.get('aiBeliefRejections', 'rej_0')).toBeUndefined();
    expect(await db.get('aiBeliefRejections', 'rej_new')).toBeDefined();
  });
});
