// K-4/N-85: при отказе IndexedDB счётчики раньше притворялись нулями —
// интерфейс читал это как «производных нет». Теперь чтение различает
// «пусто» и «посчитать не удалось»: null / { unknown: true } + reportError.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getLocalDbMock = vi.fn();

vi.mock('../../../../core/storage/localDb', () => ({
  getLocalDb: (...args: unknown[]) => getLocalDbMock(...args),
}));

vi.mock('../../../../shared/errors/reportError', () => ({
  reportError: vi.fn(),
}));

import { reportError } from '../../../../shared/errors/reportError';
import { getLocalStoreRecordCounts, SUPPORTED_LOCAL_STORES } from '../../../../core/services/LocalStoreSyncService';
import { AIDerivedDataSyncService } from '../AIDerivedDataSyncService';

const fakeDb = {
  objectStoreNames: { contains: () => true },
  count: vi.fn(async (store: string) => (store === 'aiSummaries' ? 3 : 7)),
};

describe('K-4/N-85: derived-count reads distinguish "empty" from "failed"', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getLocalStoreRecordCounts returns null on a throwing getLocalDb and reports once', async () => {
    getLocalDbMock.mockRejectedValue(new Error('idb broken'));

    const counts = await getLocalStoreRecordCounts();

    expect(counts).toBeNull();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'idb broken' }),
      expect.objectContaining({ action: 'getLocalStoreRecordCounts' }),
      'warning',
    );
  });

  it('getLocalDerivedCounts returns { unknown: true } on a throwing getLocalDb, not zeros', async () => {
    getLocalDbMock.mockRejectedValue(new Error('idb broken'));

    const counts = await AIDerivedDataSyncService.getLocalDerivedCounts();

    expect(counts).toEqual({ unknown: true });
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'idb broken' }),
      expect.objectContaining({ action: 'getLocalDerivedCounts' }),
      'warning',
    );
  });

  it('getLocalDerivedCounts still returns numbers when the db is readable', async () => {
    getLocalDbMock.mockResolvedValue(fakeDb);

    const counts = await AIDerivedDataSyncService.getLocalDerivedCounts();

    expect(counts).toEqual({
      summaries: 3,
      embeddings: 7,
      stores: SUPPORTED_LOCAL_STORES.length * 7,
      total: 3 + 7 + SUPPORTED_LOCAL_STORES.length * 7,
    });
    expect(reportError).not.toHaveBeenCalled();
  });
});
