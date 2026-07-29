import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useEmbeddingIndexer } from '../useEmbeddingIndexer';
import { AIService } from '../../services/AIService';
import { useActivityLogStore } from '../../../../shared/activity/useActivityLogStore';
import * as indexerUtils from '../../utils/embeddingIndexer';
import { AIBackgroundBudget } from '../../services/AIBackgroundBudget';

// Mock dependencies
vi.mock('../../services/AIService', () => ({
  AIService: {
    summarize: vi.fn(),
  },
}));
vi.mock('../../../../shared/activity/useActivityLogStore', () => ({
  useActivityLogStore: {
    getState: vi.fn(() => ({
      addActivity: vi.fn(),
    })),
  },
}));
vi.mock('../../utils/embeddingIndexer', () => ({
  findStaleSummaries: vi.fn(),
  findStaleDocuments: vi.fn(),
  indexDocument: vi.fn(),
  sha256Hex: vi.fn(),
}));
vi.mock('../../services/AIRestoreService', () => ({
  restoreAIDataFromCloud: vi.fn().mockResolvedValue({ skippedLocked: false }),
  reattachOrphanedAnalysis: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../../../core/services/CloudSyncService', () => ({
  CloudSyncService: {
    restoreMissingDocuments: vi.fn().mockResolvedValue({ restored: 0, hasMore: false }),
  },
}));
vi.mock('../../../../core/storage/localDb', () => ({
  getLocalDb: vi.fn().mockResolvedValue({
    get: vi.fn(),
    getAll: vi.fn().mockResolvedValue([]),
    getAllFromIndex: vi.fn().mockResolvedValue([]),
  }),
}));
vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: { uid: 'test_user' } }),
}));
vi.mock('../../services/AIProfileFacetService', () => ({
  AIProfileFacetService: {
    resummarizeDirty: vi.fn().mockResolvedValue({ count: 0 }),
    summarizePending: vi.fn().mockResolvedValue({ done: 0 }),
    incrementalUpdate: vi.fn().mockResolvedValue({}),
    build: vi.fn().mockResolvedValue({}),
  },
}));

describe('useEmbeddingIndexer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    localStorage.clear();
    localStorage.setItem('auto_summarize_enabled', 'true');
    vi.mocked(indexerUtils.findStaleSummaries).mockResolvedValue([]);
    vi.mocked(indexerUtils.findStaleDocuments).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits activity log on backoff from indexDocument', async () => {
    vi.mocked(indexerUtils.findStaleDocuments).mockResolvedValue(['doc_1']);
    vi.mocked(indexerUtils.indexDocument).mockResolvedValue('daily');

    const addActivitySpy = vi.fn();
    vi.mocked(useActivityLogStore.getState).mockReturnValue({ addActivity: addActivitySpy } as any);

    renderHook(() => useEmbeddingIndexer());
    
    // Fast forward to trigger batch
    await vi.advanceTimersByTimeAsync(10000);

    expect(addActivitySpy).toHaveBeenCalledWith(
      'Пауза фоновой активности (DAILY_LIMIT)',
      expect.objectContaining({ action: 'indexer_backoff', reason: 'DAILY_LIMIT', type: 'embed' }),
      'warning',
      'ai'
    );
  });

  /**
   * The provider being down is not a property of one note, so the pass must
   * stop. Before 446c5356 only quota and rate limits backed off and a provider
   * outage was retried every pass — the two cases above use DAILY_LIMIT and
   * RATE_LIMIT and are blind to that branch.
   */
  it('backs off when indexDocument reports a provider failure', async () => {
    vi.mocked(indexerUtils.findStaleDocuments).mockResolvedValue(['doc_1', 'doc_2']);
    vi.mocked(indexerUtils.indexDocument).mockResolvedValue('error');

    const addActivitySpy = vi.fn();
    vi.mocked(useActivityLogStore.getState).mockReturnValue({ addActivity: addActivitySpy } as any);

    renderHook(() => useEmbeddingIndexer());
    await vi.advanceTimersByTimeAsync(10000);

    // Stopped on the first failure rather than marching through the batch.
    expect(vi.mocked(indexerUtils.indexDocument)).toHaveBeenCalledTimes(1);
    expect(addActivitySpy).toHaveBeenCalledWith(
      expect.stringContaining('SERVER_ERROR'),
      expect.objectContaining({ action: 'indexer_backoff', reason: 'SERVER_ERROR' }),
      'warning',
      'ai'
    );
  });

  it('emits activity log on backoff from AIService.summarize', async () => {
    vi.mocked(indexerUtils.findStaleSummaries).mockResolvedValue(['doc_1']);
    vi.spyOn(AIBackgroundBudget, 'canSpend').mockReturnValue(true);
    
    // Simulate LocalDb
    const mockDb = {
      get: vi.fn().mockResolvedValue({ id: 'doc_1', lastSessionAt: Date.now() }),
      getAll: vi.fn().mockResolvedValue([]),
      getAllFromIndex: vi.fn().mockResolvedValue([{ version: 1, content: 'a'.repeat(100) }]),
    };
    const { getLocalDb } = await import('../../../../core/storage/localDb');
    vi.mocked(getLocalDb).mockResolvedValue(mockDb as any);

    vi.mocked(AIService.summarize).mockResolvedValue({ ok: false, error: 'RATE_LIMIT' } as any);

    const addActivitySpy = vi.fn();
    vi.mocked(useActivityLogStore.getState).mockReturnValue({ addActivity: addActivitySpy } as any);

    renderHook(() => useEmbeddingIndexer());
    
    // Fast forward to trigger batch
    await vi.advanceTimersByTimeAsync(10000);

    expect(addActivitySpy).toHaveBeenCalledWith(
      'Пауза фоновой активности (RATE_LIMIT)',
      expect.objectContaining({ action: 'indexer_backoff', reason: 'RATE_LIMIT', type: 'summarize' }),
      'warning',
      'ai'
    );
  });
});
