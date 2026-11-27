// DA-10 (владелец 27.11): написал на телефоне — открытая на ПК вкладка не видела правки,
// пока её не скрыли и не открыли снова: проход фона раз в 120 с забирал ИИ-данные, но не
// заметки. Настоящий useBackgroundSync; подменены сервисы синка.
// Мутация: убрать вызов забора заметок из прохода — красный.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const h = vi.hoisted(() => ({
  enabled: true,
  byRev: true,
  pullNotes: vi.fn().mockResolvedValue({ downloaded: 0, reconciled: 0 }),
  checkAndSyncCursor: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u_da10' }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => h.enabled }));
vi.mock('../../../../core/sync/syncFlags', () => ({ syncPullByRevEnabled: async () => h.byRev }));
vi.mock('../../../../core/sync/changeCursor', () => ({ checkAndSyncCursor: h.checkAndSyncCursor }));
vi.mock('../../../../core/services/SyncService', () => ({
  SyncService: {
    syncPending: vi.fn().mockResolvedValue({ drained: 0, failed: 0 }),
    sweepOrphanedDocuments: vi.fn().mockResolvedValue({ enqueued: 0 }),
    pullNotes: h.pullNotes,
    isRevPullUnavailable: () => false,
  },
}));
vi.mock('../../../../core/services/CloudSyncService', () => ({
  CloudSyncService: { restoreMissingDocuments: vi.fn().mockResolvedValue({ restored: 0, hasMore: false }) },
}));
vi.mock('../../services/AIRestoreService', () => ({
  restoreAIDataFromCloud: vi.fn().mockResolvedValue({ skippedLocked: false, failed: 0, sectionFailed: false }),
  reattachOrphanedAnalysis: vi.fn().mockResolvedValue(undefined),
  continueEmbeddingDownload: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../services/AIEmbeddingService', () => ({ AIEmbeddingService: { syncPendingToCloud: vi.fn() } }));
vi.mock('../../../../core/services/LocalStoreSyncService', () => ({
  LocalStoreSyncService: { retryOversizedRecords: vi.fn(), flushPending: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../services/pendingAnalysisDeletes', () => ({ retryPendingAnalysisDeletes: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../services/pendingLocalPurges', () => ({ retryPendingLocalPurges: vi.fn().mockResolvedValue(undefined) }));

import { useBackgroundSync } from '../useBackgroundSync';

describe('DA-10: проход фона забирает заметки', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.enabled = true;
    h.byRev = true;
    vi.useFakeTimers();
    Reflect.deleteProperty(window, 'requestIdleCallback');
  });
  afterEach(() => vi.useRealTimers());

  it('вкладка открыта: первый проход и каждые 120 с — забор по rev', async () => {
    renderHook(() => useBackgroundSync());
    await vi.advanceTimersByTimeAsync(5_100);
    expect(h.pullNotes).toHaveBeenCalledTimes(1);
    expect(h.pullNotes).toHaveBeenCalledWith('u_da10');
    await vi.advanceTimersByTimeAsync(120_000 + 5_100);
    expect(h.pullNotes).toHaveBeenCalledTimes(2);
  });

  it('без rev — проверка курсора, а не полный проход', async () => {
    h.byRev = false;
    renderHook(() => useBackgroundSync());
    await vi.advanceTimersByTimeAsync(5_100);
    expect(h.checkAndSyncCursor).toHaveBeenCalledWith('u_da10');
    expect(h.pullNotes).not.toHaveBeenCalled();
  });

  it('синхронизация выключена — ничего не забирается', async () => {
    h.enabled = false;
    renderHook(() => useBackgroundSync());
    await vi.advanceTimersByTimeAsync(5_100);
    expect(h.pullNotes).not.toHaveBeenCalled();
    expect(h.checkAndSyncCursor).not.toHaveBeenCalled();
  });
});
