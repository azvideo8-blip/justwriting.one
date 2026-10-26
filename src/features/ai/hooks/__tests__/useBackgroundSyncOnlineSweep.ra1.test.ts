// RA1-1 (б): после возврата сети очередь больше не ждёт 120-секундного опроса
// и 5-минутного порога возраста заметки — ссып идёт сразу по событию `online`
// и без порога возраста. Фальсификация: убрать подписку на `online` — красный.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBackgroundSync } from '../useBackgroundSync';

const mockSweep = vi.fn();
const mockSyncPending = vi.fn();

vi.mock('../../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: 'u_ra11_online' }),
}));

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

vi.mock('../../services/AIRestoreService', () => ({
  restoreAIDataFromCloud: vi.fn().mockResolvedValue({ skippedLocked: true }),
  reattachOrphanedAnalysis: vi.fn().mockResolvedValue(undefined),
  continueEmbeddingDownload: vi.fn().mockResolvedValue({ finished: true }),
}));

vi.mock('../../services/AIEmbeddingService', () => ({
  AIEmbeddingService: { syncPendingToCloud: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../../../core/services/CloudSyncService', () => ({
  CloudSyncService: { restoreMissingDocuments: vi.fn().mockResolvedValue({ restored: 0, hasMore: false }) },
}));

vi.mock('../../../../core/services/SyncService', () => ({
  SyncService: {
    syncPending: (...a: unknown[]) => mockSyncPending(...a),
    sweepOrphanedDocuments: (...a: unknown[]) => mockSweep(...a),
  },
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

describe('RA1-1: возврат сети сразу ссыпает осиротевшие заметки', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSweep.mockResolvedValue({ enqueued: 0 });
    mockSyncPending.mockResolvedValue({ drained: 0, failed: 0 });
    Reflect.deleteProperty(window, 'requestIdleCallback');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('событие online зовёт ссып без порога возраста и дренаж очереди', async () => {
    const { unmount } = renderHook(() => useBackgroundSync());
    window.dispatchEvent(new Event('online'));

    await vi.waitFor(() => {
      expect(mockSweep).toHaveBeenCalledWith('u_ra11_online', 0);
    });
    await vi.waitFor(() => {
      expect(mockSyncPending).toHaveBeenCalledWith('u_ra11_online');
    });
    unmount();
  });

  // BR-10 (ревью 25.10): проход по событию `online` раньше молча отбрасывался,
  // если другой проход уже шёл, — человек получал ссып только через опрос
  // (≤120 с) и с порогом возраста 5 мин, то есть сеть вернулась, а заметка
  // всё ещё не уехала.
  it('онлайн во время идущего прохода — ссып догоняется сразу после него', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<{ drained: number; failed: number }>(res => {
      release = () => res({ drained: 0, failed: 0 });
    });
    mockSyncPending.mockImplementationOnce(() => gate);

    const { unmount } = renderHook(() => useBackgroundSync());
    // Первый `online` начал проход и застрял на дренаже очереди.
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(mockSyncPending).toHaveBeenCalledTimes(1));

    // Сеть «моргает» ещё раз, пока проход идёт.
    window.dispatchEvent(new Event('online'));
    await new Promise(r => setTimeout(r, 10));
    expect(mockSweep.mock.calls.filter(c => c[1] === 0), 'пока проход занят, ссыпа не было').toHaveLength(0);

    // Отпускаем висящий проход — второй обязан стартовать сам, без опроса.
    await act(async () => {
      (release as unknown as () => void)();
      await new Promise(r => setTimeout(r, 300));
    });

    await vi.waitFor(() => {
      const zeroThreshold = mockSweep.mock.calls.filter(c => c[1] === 0).length;
      expect(zeroThreshold, 'ссып без порога возраста был только один раз').toBeGreaterThanOrEqual(2);
    }, { timeout: 3000 });
    unmount();
  });

  // Самопроверка 25.10: человек ушёл с экрана (разлогин, закрытая вкладка) —
  // фоновых проходов быть не должно, включая догон, который ждал в флагe.
  it('онлайн во время прохода, но экран размонтирован — догона нет', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<{ drained: number; failed: number }>(res => {
      release = () => res({ drained: 0, failed: 0 });
    });
    mockSyncPending.mockImplementationOnce(() => gate);

    const { unmount } = renderHook(() => useBackgroundSync());
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(mockSyncPending).toHaveBeenCalledTimes(1));
    // Второй `online` встаёт в очередь на догон.
    window.dispatchEvent(new Event('online'));

    unmount();
    await act(async () => {
      (release as unknown as () => void)();
      await new Promise(r => setTimeout(r, 50));
    });

    // Догон считался бы вторым ссыпом с нулевым порогом; остаётся только тот,
    // что делает уже начатый проход.
    expect(mockSweep.mock.calls.filter(c => c[1] === 0), 'после unmount прошёл догон')
      .toHaveLength(1);
  });
});
