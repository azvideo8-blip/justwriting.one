// K-4/N-85: при отказе IndexedDB счётчики раньше притворялись нулями —
// интерфейс читал это как «производных нет». Теперь чтение различает
// «пусто» и «посчитать не удалось»: null + reportError. Семейства разборов и
// векторов проверяет derivedDrift.test.ts — их читает сверка с облаком.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getLocalDbMock = vi.fn();

vi.mock('../../../../core/storage/localDb', () => ({
  getLocalDb: (...args: unknown[]) => getLocalDbMock(...args),
}));

vi.mock('../../../../shared/errors/reportError', () => ({
  reportError: vi.fn(),
}));

import { reportError } from '../../../../shared/errors/reportError';
import { getLocalStoreRecordCounts } from '../../../../core/services/LocalStoreSyncService';

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
});
