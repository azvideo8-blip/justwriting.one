import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloudSyncService } from '../CloudSyncService';

vi.mock('../../../core/crypto/keyVault', () => ({
  getSessionKey: vi.fn(() => ({})),
  getEncryptionEnabled: vi.fn(() => false),
}));

describe('LS-3: restoreMissingDocuments listing throttle scoping', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('throttling is scoped to userId: A being throttled does not throttle B', async () => {
    const downloadSpy = vi.spyOn(CloudSyncService, 'downloadAllFromCloud').mockResolvedValue({
      downloaded: 5,
      skipped: 0,
      failed: 0,
    });

    // 1. First call for User A
    const resA1 = await CloudSyncService.restoreMissingDocuments('user_A');
    expect(resA1).toEqual({ restored: 5, hasMore: false });
    expect(downloadSpy).toHaveBeenCalledWith('user_A', undefined);

    // 2. Immediate second call for User A should be throttled
    const resA2 = await CloudSyncService.restoreMissingDocuments('user_A');
    expect(resA2).toEqual({ restored: 0, hasMore: false, throttled: true });
    expect(downloadSpy).toHaveBeenCalledTimes(1);

    // 3. User B calls immediately: should NOT be throttled, listing runs for B
    const resB1 = await CloudSyncService.restoreMissingDocuments('user_B');
    expect(resB1).toEqual({ restored: 5, hasMore: false });
    expect(downloadSpy).toHaveBeenCalledWith('user_B', undefined);
    expect(downloadSpy).toHaveBeenCalledTimes(2);
  });

  it('force flag bypasses the throttle for the same user', async () => {
    vi.spyOn(CloudSyncService, 'downloadAllFromCloud').mockResolvedValue({
      downloaded: 3,
      skipped: 0,
      failed: 0,
    });

    await CloudSyncService.restoreMissingDocuments('user_A');
    const resForced = await CloudSyncService.restoreMissingDocuments('user_A', { force: true });
    expect(resForced).toEqual({ restored: 3, hasMore: false });
  });
});
