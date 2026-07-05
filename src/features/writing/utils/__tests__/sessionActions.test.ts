import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanupDraftsAfterSave } from '../sessionActions';

vi.mock('../../services/WritingDraftService', () => ({
  WritingDraftService: {
    deleteDraft: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../../core/services/SyncService', () => ({
  SyncService: {
    syncOne: vi.fn().mockResolvedValue('cloud_doc_id'),
    addToQueue: vi.fn().mockResolvedValue(undefined),
  },
}));

import { WritingDraftService } from '../../services/WritingDraftService';
import { SyncService } from '../../../../core/services/SyncService';

import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';

describe('cleanupDraftsAfterSave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes draft and performs sync for registered users when docIdToSync is provided', async () => {
    await cleanupDraftsAfterSave('user123', false, 'doc456');

    expect(WritingDraftService.deleteDraft).toHaveBeenCalledWith('user123');
    expect(SyncService.syncOne).toHaveBeenCalledWith('user123', 'doc456');
    expect(SyncService.addToQueue).not.toHaveBeenCalled();
  });

  it('deletes draft but does not perform sync if docIdToSync is null', async () => {
    await cleanupDraftsAfterSave('user123', false, null);

    expect(WritingDraftService.deleteDraft).toHaveBeenCalledWith('user123');
    expect(SyncService.syncOne).not.toHaveBeenCalled();
  });

  it('calls SyncService.addToQueue with local id when syncOne rejects', async () => {
    vi.mocked(SyncService.syncOne).mockRejectedValueOnce(new Error('Network error'));

    await cleanupDraftsAfterSave('user123', false, 'doc456');

    await vi.waitFor(() => {
      expect(SyncService.addToQueue).toHaveBeenCalledWith('doc456');
    });
  });

  it('handles addToQueue failure gracefully when syncOne rejects', async () => {
    vi.mocked(SyncService.syncOne).mockRejectedValueOnce(new Error('Network error'));
    vi.mocked(SyncService.addToQueue).mockRejectedValueOnce(new Error('Database error'));

    // Should not throw or crash
    await expect(cleanupDraftsAfterSave('user123', false, 'doc456')).resolves.not.toThrow();

    await vi.waitFor(() => {
      expect(SyncService.addToQueue).toHaveBeenCalledWith('doc456');
    });
  });

  it('clears guest draft when isGuest is true', async () => {
    const spyRemoveItem = vi.spyOn(Storage.prototype, 'removeItem');
    await cleanupDraftsAfterSave('user123', true, null);
    expect(spyRemoveItem).toHaveBeenCalledWith(STORAGE_KEYS.GUEST_DRAFT);
  });
});
