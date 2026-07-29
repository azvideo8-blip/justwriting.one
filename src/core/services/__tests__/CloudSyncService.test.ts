import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { CloudSyncService } from '../CloudSyncService';
import { DocumentService } from '../DocumentService';
import { LocalStorageService } from '../LocalStorageService';
import * as WriteBudget from '../../firebase/writeBudget';

vi.mock('../../firebase/writeBudget', () => ({
  areCloudWritesBlockedToday: vi.fn(),
  tryReserveBulkWriteBudget: vi.fn(),
  blockCloudWritesToday: vi.fn(),
  isGlobalWriteFailure: vi.fn(),
}));

describe('CloudSyncService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('restoreMissingDocuments', () => {
    it('returns { restored: 0, hasMore: true } when writes are blocked', async () => {
      vi.mocked(WriteBudget.areCloudWritesBlockedToday).mockReturnValue(true);

      const result = await CloudSyncService.restoreMissingDocuments('user_1');
      expect(result).toEqual({ restored: 0, hasMore: true });
    });

    it('returns early when budget runs out', async () => {
      vi.mocked(WriteBudget.areCloudWritesBlockedToday).mockReturnValue(false);
      vi.mocked(WriteBudget.tryReserveBulkWriteBudget)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);

      vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([
        { id: 'cloud_1' } as any,
        { id: 'cloud_2' } as any,
      ]);
      vi.spyOn(LocalStorageService, 'getGuestDocuments').mockResolvedValue([]);
      const addLocalCopySpy = vi.spyOn(CloudSyncService, 'addLocalCopy').mockResolvedValue('local_1');

      const result = await CloudSyncService.restoreMissingDocuments('user_1');
      expect(result).toEqual({ restored: 1, hasMore: true });
      expect(addLocalCopySpy).toHaveBeenCalledTimes(1);
    });

    it('returns hasMore false when all documents restored successfully', async () => {
      vi.mocked(WriteBudget.areCloudWritesBlockedToday).mockReturnValue(false);
      vi.mocked(WriteBudget.tryReserveBulkWriteBudget).mockReturnValue(true);

      vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([
        { id: 'cloud_1' } as any,
        { id: 'cloud_2' } as any,
      ]);
      vi.spyOn(LocalStorageService, 'getGuestDocuments').mockResolvedValue([]);
      const addLocalCopySpy = vi.spyOn(CloudSyncService, 'addLocalCopy').mockResolvedValue('local_1');

      const result = await CloudSyncService.restoreMissingDocuments('user_1');
      expect(result).toEqual({ restored: 2, hasMore: false });
      expect(addLocalCopySpy).toHaveBeenCalledTimes(2);
    });
  });
});
