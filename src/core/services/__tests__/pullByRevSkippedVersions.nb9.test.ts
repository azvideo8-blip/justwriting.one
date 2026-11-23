// NB-9 (ревью 0.11.24, N-2): забор по rev скачивает новую заметку через
// addLocalCopy и раньше выбрасывал её skippedVersions — битые версии новой
// заметки молчали, хотя у связанной (reconcile) тот же счёт шёл в corrupted.
// Мутация: вернуть `await …addLocalCopy(…)` без `.skippedVersions` в страничном
// пути — corrupted 0, красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

vi.mock('../../data/providers/pullChanges', () => ({ pullChangesSince: vi.fn() }));
vi.mock('../DocumentService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../DocumentService')>();
  return { ...actual, parseCloudDocument: vi.fn() };
});
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { pullChangesSince } from '../../data/providers/pullChanges';
import { parseCloudDocument } from '../DocumentService';
import { CloudSyncService } from '../CloudSyncService';
import { LocalStorageService } from '../LocalStorageService';
import type { Document } from '../../../types';

const UID = 'u_nb9_pull';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(pullChangesSince).mockReset();
  vi.mocked(parseCloudDocument).mockReset();
});

describe('NB-9: забор по rev считает пропущенные битые версии новой заметки', () => {
  it('addLocalCopy пропустил 2 версии → corrupted 2, downloaded 1', async () => {
    vi.spyOn(CloudSyncService, 'relinkOrphanedDocuments').mockResolvedValue({ relinked: 0, skippedIds: [] });
    vi.spyOn(LocalStorageService, 'getDocumentsByOwner').mockResolvedValue([]);
    const addLocalCopy = vi.spyOn(CloudSyncService, 'addLocalCopy').mockResolvedValue({ localId: 'loc_new', skippedVersions: 2 });
    vi.mocked(parseCloudDocument).mockResolvedValue({ id: 'cloud_new', uuid: 'cloud_new', title: 'Синтетика' } as unknown as Document);
    vi.mocked(pullChangesSince).mockImplementation(async (_uid, table, since) =>
      (table === 'documents' && since === 0
        ? { rows: [{ uuid: 'cloud_new', rev: 1, deleted_at: null }] }
        : { rows: [] }) as never);

    const res = await CloudSyncService.pullNotesByRev(UID);

    expect(addLocalCopy).toHaveBeenCalledWith(UID, 'cloud_new', expect.objectContaining({ uuid: 'cloud_new' }));
    expect(res.downloaded).toBe(1);
    expect(res.corrupted).toBe(2);
  });
});
