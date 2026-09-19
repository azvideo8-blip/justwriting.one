import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cloudSyncEnabled } from '../cloudSyncEnabled';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { AISummaryService } from '../../../features/ai/services/AISummaryService';
import { AIEmbeddingService } from '../../../features/ai/services/AIEmbeddingService';
import { LocalStoreSyncService } from '../../services/LocalStoreSyncService';
import { DataProvider } from '../../data';
import * as auth from '../../auth';
import { getLocalDb } from '../../storage/localDb';
import { setProfileLoaded } from '../../crypto/cryptoHelpers';

vi.mock('../../data', () => ({
  DataProvider: {
    saveSummary: vi.fn(),
    saveEmbedding: vi.fn(),
    saveLocalStoreRecord: vi.fn(),
    deleteLocalStoreRecord: vi.fn(),
  },
}));

vi.mock('../../auth', () => ({
  getCurrentUser: vi.fn(),
}));

describe('SEC-8: cloudSyncEnabled switch governing all background uploads', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    setProfileLoaded('user_123', true);
    const db = await getLocalDb();
    await db.clear('aiSummaries');
    await db.clear('aiEmbeddings');
    await db.clear('aiPortrait');
  });

  it('returns false when localStorage key is unset or not "true"', () => {
    expect(cloudSyncEnabled()).toBe(false);
    expect(cloudSyncEnabled('user_123')).toBe(false);

    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED('user_123'), 'false');
    expect(cloudSyncEnabled('user_123')).toBe(false);

    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED('user_123'), 'true');
    expect(cloudSyncEnabled('user_123')).toBe(true);
  });

  it('performs 0 cloud calls on note analysis when switch is OFF (summaries, embeddings, derived stores)', async () => {
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED('user_123'), 'false');
    vi.mocked(auth.getCurrentUser).mockReturnValue({ uid: 'user_123' } as unknown as auth.AppUser);

    // 1. AISummaryService.save
    await AISummaryService.save({
      documentId: 'doc_1',
      documentUuid: 'uuid-doc_1',
      summary: 'Тестовая сводка',
      tone: 'нейтральный',
      frequentWords: [],
      insights: [],
      themes: [],
      extractedFacts: [],
      processedAt: Date.now(),
    });
    expect(DataProvider.saveSummary).not.toHaveBeenCalled();

    // 2. AIEmbeddingService.save
    await AIEmbeddingService.save({
      documentId: 'doc_1',
      documentUuid: 'uuid-doc_1',
      vectors: [[0.1, 0.2, 0.3]],
      processedAt: Date.now(),
      model: 'test-model',
      dim: 3,
      contentHash: 'hash-1',
    });
    expect(DataProvider.saveEmbedding).not.toHaveBeenCalled();

    // 3. LocalStoreSyncService flush
    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'p1');
    const syncRes = await LocalStoreSyncService.flushPending();
    expect(DataProvider.saveLocalStoreRecord).not.toHaveBeenCalled();
    expect(syncRes.synced).toBe(0);
  });

  it('performs cloud writes on write when switch is ON', async () => {
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED('user_123'), 'true');
    vi.mocked(auth.getCurrentUser).mockReturnValue({ uid: 'user_123' } as unknown as auth.AppUser);
    const db = await getLocalDb();
    await db.put('aiPortrait', { id: 'p1', portrait: 'Портрет', updatedAt: Date.now(), generatedAtDelta: 0 });

    // 1. AISummaryService.save
    await AISummaryService.save({
      documentId: 'doc_1',
      documentUuid: 'uuid-doc_1',
      summary: 'Тестовая сводка',
      tone: 'нейтральный',
      frequentWords: [],
      insights: [],
      themes: [],
      extractedFacts: [],
      processedAt: Date.now(),
    });
    expect(DataProvider.saveSummary).toHaveBeenCalled();

    // 2. AIEmbeddingService.save
    await AIEmbeddingService.save({
      documentId: 'doc_1',
      documentUuid: 'uuid-doc_1',
      vectors: [[0.1, 0.2, 0.3]],
      processedAt: Date.now(),
      model: 'test-model',
      dim: 3,
      contentHash: 'hash-1',
    });
    expect(DataProvider.saveEmbedding).toHaveBeenCalled();

    // 3. LocalStoreSyncService flush
    LocalStoreSyncService.scheduleStoreSync('aiPortrait', 'p1');
    const syncRes = await LocalStoreSyncService.flushPending();
    expect(DataProvider.saveLocalStoreRecord).toHaveBeenCalled();
    expect(syncRes.synced).toBe(1);
  });

  it('manual backfill pass (syncAllLocalStores) works even when switch is OFF', async () => {
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED('user_123'), 'false');
    vi.mocked(auth.getCurrentUser).mockReturnValue({ uid: 'user_123' } as unknown as auth.AppUser);
    const db = await getLocalDb();
    await db.put('aiPortrait', { id: 'p1', portrait: 'Портрет', updatedAt: Date.now(), generatedAtDelta: 0 });

    const res = await LocalStoreSyncService.syncAllLocalStores('user_123');
    expect(DataProvider.saveLocalStoreRecord).toHaveBeenCalled();
    expect(res.synced).toBe(1);
  });
});
