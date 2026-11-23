import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../../core/storage/localDb';
import { NoteAnalysisService } from '../NoteAnalysisService';
import { restoreAIDataFromCloud } from '../AIRestoreService';
import { DataProvider } from '../../../../core/data';
import {
  readPersistedAnalysisDeletes,
  retryPendingAnalysisDeletes,
  getPendingAnalysisDeleteKeys,
} from '../pendingAnalysisDeletes';

const USER = 'user_retry_analysis';
const DOC_ID = 'local_doc_analysis_1';
const CANON_UUID = 'canon-analysis-uuid-1';

vi.mock('../../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: USER }),
}));

vi.mock('../../../../core/data', () => ({
  DataProvider: {
    deleteSummary: vi.fn(),
    deleteEmbedding: vi.fn(),
    getUserSummaries: vi.fn(),
    getLocalStoreRecords: vi.fn().mockResolvedValue([]),
    getPublicDocSummaries: vi.fn().mockResolvedValue([]),
  },
}));

describe('A-3.3 (F-008): note analysis delete retry and restore suppression', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    const db = await getLocalDb(USER);
    await db.clear('documents');
    await db.clear('aiSummaries');
    await db.clear('aiTimeline');

    await db.put('documents', {
      id: DOC_ID,
      uuid: CANON_UUID,
      guestId: USER,
      title: 'Analysis Test Doc',
      currentVersion: 1,
      totalWords: 10,
      totalDuration: 10,
      sessionsCount: 1,
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      tags: [],
      aiProcessed: true,
    });
  });

  it('cloud delete throws -> marker exists -> restore skips that summary -> next background pass deletes and clears marker', async () => {
    const db = await getLocalDb(USER);

    // 1. Clear analysis when cloud delete fails
    vi.mocked(DataProvider.deleteSummary).mockRejectedValueOnce(new Error('Network error on deleteSummary'));

    await expect(NoteAnalysisService.clearAnalysis(DOC_ID)).resolves.toMatchObject({ cloudSynced: false, localFailed: false });

    // Assert 1: Marker exists
    const markers = readPersistedAnalysisDeletes();
    expect(markers).toHaveLength(1);
    expect(markers![0]!.uid).toBe(USER);
    expect(markers![0]!.canonicalId).toBe(CANON_UUID);
    expect(getPendingAnalysisDeleteKeys(USER)?.has(CANON_UUID)).toBe(true);

    // 2. Daily restore runs: cloud still has the summary
    vi.mocked(DataProvider.getUserSummaries).mockResolvedValueOnce([
      {
        id: CANON_UUID,
        document_id: CANON_UUID,
        user_id: USER,
        summary: 'Cloud summary that should not be restored',
        themes: [],
        processed_at: 5000,
      } as any,
    ]);

    const restoreRes = await restoreAIDataFromCloud(USER);

    // Assert 2: Restore skipped that summary!
    expect(restoreRes.summaries).toBe(0);
    const restoredSummary = await db.get('aiSummaries', DOC_ID);
    expect(restoredSummary).toBeUndefined();

    // 3. Background pass runs with network back up
    vi.mocked(DataProvider.deleteSummary).mockResolvedValue(undefined);
    vi.mocked(DataProvider.deleteEmbedding).mockResolvedValue(undefined);

    const retryRes = await retryPendingAnalysisDeletes(USER);

    // Assert 3: Retried delete succeeded and cleared marker
    expect(retryRes.deleted).toBe(1);
    expect(DataProvider.deleteSummary).toHaveBeenCalledWith(USER, CANON_UUID);
    expect(DataProvider.deleteEmbedding).toHaveBeenCalledWith(USER, CANON_UUID);
    expect(readPersistedAnalysisDeletes()).toHaveLength(0);
  });
});
