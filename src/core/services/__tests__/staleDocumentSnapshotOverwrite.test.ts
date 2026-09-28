import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';
import { NoteAnalysisService } from '../../../features/ai/services/NoteAnalysisService';
import { SyncService } from '../SyncService';
import { AIService } from '../../../features/ai/services/AIService';
import { DocumentService } from '../DocumentService';
import { LocalDocumentService } from '../LocalDocumentService';

const USER = 'user_stale_snapshot';
const DOC_ID = 'local_doc_snapshot_1';

vi.mock('../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: USER }),
}));

vi.mock('../../../features/ai/services/AIService', () => ({
  AIService: {
    summarize: vi.fn(),
  },
}));

vi.mock('../DocumentService', () => ({
  DocumentService: {
    getCloudDocumentVersions: vi.fn(),
  },
}));

describe('A-4 (F-032 + F-020): stale document snapshot overwrite', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await getLocalDb(USER);
    await db.clear('documents');
    await db.clear('versions');
    await db.clear('aiSummaries');
  });

  it('trash the note while analysis is pending -> after analysis the note is still trashed', async () => {
    const db = await getLocalDb(USER);
    await db.put('documents', {
      id: DOC_ID,
      uuid: 'uuid-stale-1',
      guestId: USER,
      title: 'Note to Trash',
      currentVersion: 1,
      totalWords: 50,
      totalDuration: 60,
      sessionsCount: 1,
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      tags: [],
    });
    await db.put('versions', {
      id: 'v-stale-1',
      documentId: DOC_ID,
      guestId: USER,
      version: 1,
      content: 'This is the body of the note to trash with enough words to satisfy length checks.',
      wordCount: 14,
      wordsAdded: 14,
      charsAdded: 80,
      duration: 60,
      wpm: 14,
      sessionStartedAt: 1000,
      savedAt: 1000,
    });

    vi.mocked(AIService.summarize).mockImplementation(async () => {
      // While AI is pending, user trashes the note
      await LocalDocumentService.trashDocument(DOC_ID, 12345, USER);
      return {
        ok: true,
        summary: {
          tone: 'neutral',
          frequentWords: ['note'],
          insights: [],
          themes: ['work'],
          extractedFacts: [],
        },
      } as any;
    });

    await NoteAnalysisService.analyze(DOC_ID);

    // The note must STILL be trashed, not resurrected by stale snapshot
    const finalDoc = await db.get('documents', DOC_ID);
    expect(finalDoc?.trashedAt).toBeDefined();
    expect(finalDoc?.aiProcessed).toBe(true);
  });

  it('save a version during getUnsyncedSummary network call -> currentVersion is not rolled back', async () => {
    const db = await getLocalDb(USER);
    await db.put('documents', {
      id: DOC_ID,
      uuid: 'uuid-stale-2',
      guestId: USER,
      title: 'Note to Sync',
      linkedCloudId: 'cloud-stale-2',
      currentVersion: 1,
      lastSyncedCloudVersion: undefined,
      totalWords: 50,
      totalDuration: 60,
      sessionsCount: 1,
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      tags: [],
    });

    vi.mocked(DocumentService.getCloudDocumentVersions).mockImplementation(async () => {
      // While network call is in flight, user saves version 2
      const tx = db.transaction('documents', 'readwrite');
      const fresh = await tx.store.get(DOC_ID);
      if (fresh) {
        await tx.store.put({ ...fresh, currentVersion: 2 });
      }
      await tx.done;
      return new Map([['cloud-stale-2', 1]]);
    });

    await SyncService.getUnsyncedSummary(USER);

    // currentVersion must STILL be 2, not rolled back to 1
    const finalDoc = await db.get('documents', DOC_ID);
    expect(finalDoc?.currentVersion).toBe(2);
    expect(finalDoc?.lastSyncedCloudVersion).toBe(1);
  });
});
