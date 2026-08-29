// Ошибка из журнала, спамившая каждый фоновый проход:
//   ai_embedding_cloud_sync: new row violates row-level security policy
//   for table "ai_embeddings"  (POST /rest/v1/ai_embeddings 403)
//
// Политика RLS требует exists(select 1 from documents d where d.uuid =
// document_id ...). Локальный `local_…` её не проходит. save() подставлял
// канонический uuid, а повторная выгрузка отставших брала запись как есть —
// без uuid, отлетала по RLS, оставалась pending и повторялась снова.
// Фальсификация: убрать обогащение в syncPendingToCloud — первый тест краснеет.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

const saveEmbedding = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u1' }) }));
vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  maybeEncrypt: async (p: Record<string, unknown>) => p,
  maybeDecrypt: async (p: Record<string, unknown>) => p,
  DecryptionError: class extends Error {},
}));
vi.mock('../../../../core/data', () => ({
  DataProvider: {
    saveEmbedding: (...a: unknown[]) => saveEmbedding(...a),
    getEmbedding: vi.fn(),
  },
}));

import { AIEmbeddingService } from '../AIEmbeddingService';
import { getLocalDb } from '../../../../core/storage/localDb';

const CANON = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('выгрузка эмбеддингов ключуется каноническим uuid', () => {
  beforeEach(async () => {
    saveEmbedding.mockClear();
    localStorage.clear();
    const db = await getLocalDb();
    for (const store of ['documents', 'aiEmbeddings'] as const) {
      for (const r of await db.getAll(store)) {
        await db.delete(store, (r as { id?: string; documentId?: string }).id
          ?? (r as { documentId: string }).documentId);
      }
    }
  });

  it('отставшая запись без documentUuid выгружается по uuid документа, а не по local_ id', async () => {
    const db = await getLocalDb();
    await db.put('documents', {
      id: 'local_note_1', uuid: CANON, guestId: 'u1', title: 'Заметка',
      currentVersion: 1, totalWords: 5, totalDuration: 0, sessionsCount: 1,
      firstSessionAt: 1000, lastSessionAt: 1000, tags: [],
    } as never);
    // Запись сделана до появления documentUuid — ровно тот случай из журнала.
    await db.put('aiEmbeddings', {
      documentId: 'local_note_1', vectors: [[0.1, 0.2]], chunkTexts: ['текст'],
      model: 'm', dim: 2, contentHash: 'h', processedAt: 1, schemaV: 1,
    } as never);

    await AIEmbeddingService.syncPendingToCloud();

    expect(saveEmbedding).toHaveBeenCalledTimes(1);
    expect(saveEmbedding.mock.calls[0]![1]).toBe(CANON);
  });

  it('запись без документа не выгружается и не хоронится — ждёт документа', async () => {
    const db = await getLocalDb();
    await db.put('aiEmbeddings', {
      documentId: 'local_orphan', vectors: [[0.1]], chunkTexts: [],
      model: 'm', dim: 1, contentHash: 'h', processedAt: 1, schemaV: 1,
    } as never);

    await AIEmbeddingService.syncPendingToCloud();

    // Запроса в сеть нет — значит нет и 403, и строки в журнале.
    expect(saveEmbedding).not.toHaveBeenCalled();
    // И запись не похоронена: при восстановлении из облака данные ИИ могут
    // приехать раньше заметок, и пометка «пропущено» была бы необратимой.
    const rec = await db.get('aiEmbeddings', 'local_orphan');
    expect((rec as { cloudSkipped?: boolean } | undefined)?.cloudSkipped).toBeFalsy();
  });
});
