// TEST-1 §2.6 (producer half): saving a version announces doc-version-saved so
// the AI domain can reindex without visiting the AI page.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../LocalStorageService', () => ({
  LocalStorageService: {
    saveVersionToLocal: vi.fn(async () => ({
      ok: true as const,
      newVersion: 2,
      prevContent: '',
      existing: { guestId: 'g1', totalWords: 10, totalDuration: 5, linkedCloudId: '' },
    })),
  },
}));
vi.mock('../ProfileUpdater', () => ({
  ProfileUpdater: { updateLocalProfile: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../features/ai/services/AIEmbeddingService', () => ({ AIEmbeddingService: {} }),);

import { StorageService } from '../StorageService';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('2.6 doc-version-saved event', () => {
  it('dispatches with the saved document id after the local tx commits', async () => {
    const events: Array<{ documentId?: string }> = [];
    const listener = (e: Event) => events.push((e as CustomEvent<{ documentId?: string }>).detail ?? {});
    window.addEventListener('doc-version-saved', listener);

    await StorageService.saveVersion('u1', 'doc_42', { content: 'текст', duration: 1 } as never);

    window.removeEventListener('doc-version-saved', listener);
    expect(events).toContainEqual({ documentId: 'doc_42' });
  });
});
