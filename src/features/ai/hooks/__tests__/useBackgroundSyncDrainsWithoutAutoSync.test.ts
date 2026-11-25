// R-1: фоновый дренаж очереди сохранения должен выполняться даже если cloudSyncEnabled === false.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBackgroundSync } from '../useBackgroundSync';

const mockSyncPending = vi.fn().mockResolvedValue({ drained: 1, failed: 0 });
const mockRestore = vi.fn().mockResolvedValue({ restored: 0, hasMore: false });

vi.mock('../../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: 'u_no_autosync_1' }),
}));

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({
  cloudSyncEnabled: () => false,
}));

vi.mock('../../../../core/services/SyncService', () => ({
  SyncService: {
    syncPending: (...a: unknown[]) => mockSyncPending(...a),
    sweepOrphanedDocuments: vi.fn().mockResolvedValue({ enqueued: 0 }),
  },
}));

const mockRetryPurges = vi.fn().mockResolvedValue({ purged: 0, failed: 0, forgotten: 0, slowed: 0 });
vi.mock('../../services/pendingLocalPurges', () => ({ retryPendingLocalPurges: (...a: unknown[]) => mockRetryPurges(...a) }));

vi.mock('../../../../core/services/CloudSyncService', () => ({
  CloudSyncService: {
    restoreMissingDocuments: (...a: unknown[]) => mockRestore(...a),
  },
}));

describe('D-22 useBackgroundSync calls syncPending without force when cloudSyncEnabled is false', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    Reflect.deleteProperty(window, 'requestIdleCallback');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls syncPending without { force: true }, respecting auto-sync toggle, without running cloud restore', async () => {
    renderHook(() => useBackgroundSync());
    await vi.advanceTimersByTimeAsync(5_100);

    expect(mockSyncPending).toHaveBeenCalledWith('u_no_autosync_1');
    expect(mockRestore).not.toHaveBeenCalled();
  });

  // Дейлик 24.11 (Н-1): уборка пересказа скрытой заметки локальная, тумблер выгрузки
  // её не касается. Мутация: вернуть голый return — красный.
  it('повторяет локальную уборку и при выключенной автосинхронизации', async () => {
    renderHook(() => useBackgroundSync());
    await vi.advanceTimersByTimeAsync(5_100);

    expect(mockRetryPurges).toHaveBeenCalledTimes(1);
    expect(mockRetryPurges).toHaveBeenCalledWith('u_no_autosync_1');
    expect(mockRestore).not.toHaveBeenCalled();
  });
});
