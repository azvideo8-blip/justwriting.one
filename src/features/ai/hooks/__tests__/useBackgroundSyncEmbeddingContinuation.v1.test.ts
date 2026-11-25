// В-1 (замер 08.10.2026): начатая догрузка векторов из облака продолжается
// каждым фоновым проходом. До В-1 она шла только в полном проходе, а тот — раз в
// сутки, поэтому архив в 1000 заметок на новом устройстве догружался десять
// суток, и всё это время `indexPending` ждал облако и не трогал заметки, которых
// в нём нет.
//
// На базе (08d10343) красный: `continueEmbeddingDownload` там нет, и фоновый
// проход его не зовёт. Мутация из тикета — убрать вызов из `runPass` — красный
// здесь же.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBackgroundSync } from '../useBackgroundSync';

const UID = 'u_v1_download';

const mockRestoreAi = vi.fn();
const mockContinue = vi.fn();

vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: UID }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../services/AIRestoreService', () => ({
  restoreAIDataFromCloud: (...a: unknown[]) => mockRestoreAi(...a),
  continueEmbeddingDownload: (...a: unknown[]) => mockContinue(...a),
  reattachOrphanedAnalysis: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../services/AIEmbeddingService', () => ({
  AIEmbeddingService: { syncPendingToCloud: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../../../core/services/CloudSyncService', () => ({
  CloudSyncService: { restoreMissingDocuments: vi.fn().mockResolvedValue({ restored: 0, hasMore: false }) },
}));
vi.mock('../../../../core/services/SyncService', () => ({
  SyncService: { syncPending: vi.fn().mockResolvedValue(undefined), sweepOrphanedDocuments: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../../../core/services/LocalStoreSyncService', () => ({
  LocalStoreSyncService: { retryOversizedRecords: vi.fn(), flushPending: vi.fn().mockResolvedValue(undefined) },
}));
// Настоящий модуль в конце прохода уходит в сеть и под fake timers не
// завершается: второй проход не случился бы из-за него, а не из-за В-1.
vi.mock('../../services/pendingAnalysisDeletes', () => ({
  retryPendingAnalysisDeletes: vi.fn().mockResolvedValue(undefined),
}));
const mockRetryPurges = vi.hoisted(() => vi.fn());
vi.mock('../../services/pendingLocalPurges', () => ({ retryPendingLocalPurges: mockRetryPurges }));
vi.mock('../../../../shared/activity/useActivityLogStore', () => ({
  useActivityLogStore: { getState: () => ({ addActivity: vi.fn() }) },
}));
vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));

describe('В-1: фоновый проход продолжает догрузку векторов', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    Reflect.deleteProperty(window, 'requestIdleCallback');
    localStorage.clear();
    mockRestoreAi.mockResolvedValue({ skippedLocked: false, maxUpdatedAt: 0 });
    mockContinue.mockResolvedValue({ embeddings: 0, failed: 0, markedSynced: 0, finished: false });
    mockRetryPurges.mockResolvedValue({ purged: 0, failed: 0, forgotten: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('зовёт продолжение даже тогда, когда полный проход на сегодня уже сделан', async () => {
    // Ключ троттлинга AUD-13 закрывает полный проход на сутки — догрузка не
    // обязана ждать следующего дня.
    localStorage.setItem(`ai_restore_done_date_${UID}`, new Date().toISOString().slice(0, 10));

    renderHook(() => useBackgroundSync());
    await vi.advanceTimersByTimeAsync(5_100);

    expect(mockRestoreAi.mock.calls.some(c => c[1] === undefined),
      'полный проход на сегодня уже был').toBe(false);
    expect(mockContinue).toHaveBeenCalledTimes(1);
    expect(mockContinue).toHaveBeenCalledWith(UID);
  });

  // Дейлик 24.11 (Н-1): при включённой синхронизации уборка — после забора из облака
  // (он мог вернуть убираемое) и один раз за проход.
  it('локальная уборка идёт после забора из облака, один раз', async () => {
    renderHook(() => useBackgroundSync());
    await vi.advanceTimersByTimeAsync(5_100);

    expect(mockRetryPurges).toHaveBeenCalledTimes(1);
    expect(mockRetryPurges.mock.invocationCallOrder[0]!).toBeGreaterThan(mockRestoreAi.mock.invocationCallOrder.at(-1)!);
  });

  it('зовёт продолжение каждым проходом, а не одним', async () => {
    renderHook(() => useBackgroundSync());
    await vi.advanceTimersByTimeAsync(5_100);
    // Интервал фонового прохода — 120 секунд, и он сам ставит таймер бездействия.
    await vi.advanceTimersByTimeAsync(126_000);

    expect(mockContinue).toHaveBeenCalledTimes(2);
  });
});
