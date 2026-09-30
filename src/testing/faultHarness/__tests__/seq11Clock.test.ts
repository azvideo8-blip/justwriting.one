import { describe, it, expect, vi, afterEach } from 'vitest';
import { MatrixRunner } from '../matrixRunner';
import { LocalStorageService } from '../../../core/services/LocalStorageService';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Флейк полного прогона: облачная запись addCloudCopy в одной миллисекунде,
// локальная отметка lastSeenCloudUpdatedAt и правка «другого устройства» — в
// следующей, общей. Эмуляция триггера updated_at ставила правке «сейчас», облако
// выглядело не новее, reconcile пропускал заметку, и ячейка красила P1.
describe('seq11: the seeded cloud edit is newer whatever the clock does', () => {
  it('holds when the local mark and the seeded edit share a millisecond', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: 1_700_000_000_000 });
    const orig = LocalStorageService.migrateDocumentOwner.bind(LocalStorageService);
    vi.spyOn(LocalStorageService, 'migrateDocumentOwner').mockImplementation(async (...a: Parameters<typeof orig>) => {
      await orig(...a);
      vi.setSystemTime(Date.now() + 50); // время прошло между облачной записью и локальной отметкой
    });
    const r = await new MatrixRunner().runCell('seq11_reconcile_edit_no_task', 'none', 'sync_cloud', false);
    expect(r.notes).toEqual([]);
    expect(r.p1Held).toBe(true);
  });
});
