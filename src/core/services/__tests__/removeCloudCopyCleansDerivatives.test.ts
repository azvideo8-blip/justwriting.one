import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloudSyncService } from '../CloudSyncService';
import { DocumentService } from '../DocumentService';

const USER = 'u_rm_cloud_copy_test';

vi.mock('../DocumentService', () => ({
  DocumentService: {
    deleteDocument: vi.fn().mockResolvedValue(undefined),
  },
}));

/**
 * Облачные сводку и вектор удаляет сам deleteDocument провайдера — до
 * надгробия и с проверкой ошибки на каждом шаге (это закреплено в
 * providerEquivalence: versions → ai_summaries → ai_embeddings → documents).
 * Здесь проверяется, что removeCloudCopy идёт именно через него, а сбой
 * удаления не превращается в «удалено» (N-53).
 */
describe('removeCloudCopy deletes through the provider, which removes the AI derivatives', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls the provider delete (which removes summary and embedding first)', async () => {
    await CloudSyncService.removeCloudCopy(USER, 'cloud_doc_uuid_123');
    expect(DocumentService.deleteDocument).toHaveBeenCalledWith(USER, 'cloud_doc_uuid_123');
  });

  it('a failed cloud delete surfaces instead of passing as removed', async () => {
    vi.mocked(DocumentService.deleteDocument).mockRejectedValueOnce(new Error('ai_summaries delete failed'));
    await expect(CloudSyncService.removeCloudCopy(USER, 'cloud_doc_uuid_123')).rejects.toThrow('ai_summaries');
  });
});
