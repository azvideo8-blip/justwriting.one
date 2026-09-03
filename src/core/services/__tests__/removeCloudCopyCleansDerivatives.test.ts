import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloudSyncService } from '../CloudSyncService';
import { DocumentService } from '../DocumentService';
import { DataProvider } from '../../data';

const USER = 'u_rm_cloud_copy_test';

vi.mock('../DocumentService', () => ({
  DocumentService: {
    deleteDocument: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('Area 1: removeCloudCopy must delete cloud AI derivatives', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('FAILING TEST: removeCloudCopy deletes the cloud document but leaves cloud summary and embedding behind', async () => {
    const delSummary = vi.spyOn(DataProvider, 'deleteSummary').mockResolvedValue(undefined);
    const delEmbedding = vi.spyOn(DataProvider, 'deleteEmbedding').mockResolvedValue(undefined);

    await CloudSyncService.removeCloudCopy(USER, 'cloud_doc_uuid_123');

    expect(DocumentService.deleteDocument).toHaveBeenCalledWith(USER, 'cloud_doc_uuid_123');
    // Currently fails: removeCloudCopy does not delete cloud summary or embedding!
    expect(delSummary).toHaveBeenCalledWith(USER, 'cloud_doc_uuid_123');
    expect(delEmbedding).toHaveBeenCalledWith(USER, 'cloud_doc_uuid_123');
  });
});
