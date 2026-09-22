// AUD-13: троттлинг фонового восстановления ставился глобально и до успеха —
// упавший проход заставлял человека ждать сутки до повторной попытки, а ключ
// был общим для всех аккаунтов браузера. Теперь ключ по uid и ставится только
// после полного прохода. Фальсификация: вернуть старый ключ/раннюю установку.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBackgroundSync } from '../useBackgroundSync';

const mockRestore = vi.fn();
const mockRestoreAi = vi.fn();

vi.mock('../../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: 'u_throttle_1' }),
}));

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

vi.mock('../../services/AIRestoreService', () => ({
  restoreAIDataFromCloud: (...a: unknown[]) => mockRestoreAi(...a),
  reattachOrphanedAnalysis: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/AIEmbeddingService', () => ({
  AIEmbeddingService: { syncPendingToCloud: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../../../core/services/CloudSyncService', () => ({
  CloudSyncService: { restoreMissingDocuments: (...a: unknown[]) => mockRestore(...a) },
}));

vi.mock('../../../../core/services/SyncService', () => ({
  SyncService: { syncPending: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../../../core/services/LocalStoreSyncService', () => ({
  LocalStoreSyncService: {
    retryOversizedRecords: vi.fn(),
    flushPending: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../../shared/activity/useActivityLogStore', () => ({
  useActivityLogStore: { getState: () => ({ addActivity: vi.fn() }) },
}));

vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({
  cloudSyncEnabled: () => true,
}));

describe('AUD-13 restore throttle is per-account and only after success', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Гарантируем setTimeout-путь: sinon fake timers не управляют настоящим
    // requestIdleCallback, если он есть в окружении.
    Reflect.deleteProperty(window, 'requestIdleCallback');
    localStorage.clear();
    mockRestoreAi.mockResolvedValue({ skippedLocked: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not set the throttle key when the pass fails', async () => {
    mockRestore.mockRejectedValue(new Error('offline'));

    renderHook(() => useBackgroundSync());
    await vi.advanceTimersByTimeAsync(5_100);

    expect(mockRestore).toHaveBeenCalled();
    expect(localStorage.getItem('ai_restore_done_date_u_throttle_1')).toBeNull();
  });

  it('keys the throttle by account and sets it after a full pass', async () => {
    mockRestore.mockResolvedValue({ restored: 2, hasMore: false });

    renderHook(() => useBackgroundSync());
    await vi.advanceTimersByTimeAsync(5_100);

    expect(localStorage.getItem('ai_restore_done_date_u_throttle_1'))
      .toBe(new Date().toISOString().slice(0, 10));
  });
});
