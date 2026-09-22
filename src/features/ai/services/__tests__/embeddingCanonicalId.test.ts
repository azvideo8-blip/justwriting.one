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
import { reportError } from '../../../../shared/errors/reportError';

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

/**
 * Третий путь выгрузки — ручной проход `AIDerivedDataSyncService`. Он читает
 * записи из хранилища как есть и в 0.8.22 остался в стороне: обогащение uuid
 * тогда расставили по вызывающим (`save` и `syncPendingToCloud`), а не в самой
 * точке выгрузки. На живом архиве это дало 114 отказов по политике доступа за
 * один заход.
 */
describe('saveEmbeddingToCloud сам достаёт канонический номер', () => {
  beforeEach(async () => {
    saveEmbedding.mockClear();
    const db = await getLocalDb();
    for (const store of ['documents', 'aiEmbeddings'] as const) {
      for (const r of await db.getAll(store)) {
        await db.delete(store, (r as { id?: string; documentId?: string }).id
          ?? (r as { documentId: string }).documentId);
      }
    }
  });

  const rawEmbedding = {
    documentId: 'local_note_9',
    vectors: [[0.1, 0.2]],
    chunkTexts: ['кусок'],
    model: 'm', dim: 2, contentHash: 'h', processedAt: 1, schemaV: 3,
  };

  it('запись без documentUuid всё равно уезжает под uuid заметки', async () => {
    const { saveEmbeddingToCloud } = await import('../AIEmbeddingService');
    const db = await getLocalDb();
    await db.put('documents', {
      id: 'local_note_9', uuid: CANON, guestId: 'u1', title: 'Заметка',
      currentVersion: 1, totalWords: 5, totalDuration: 0, sessionsCount: 1,
      firstSessionAt: 1, lastSessionAt: 1, tags: [],
    } as never);

    await saveEmbeddingToCloud('u1', rawEmbedding as never);

    expect(saveEmbedding).toHaveBeenCalledWith('u1', CANON, expect.anything());
  });

  it('вектор без заметки отказывает громко, а не уезжает под номером, который база отвергнет', async () => {
    const { saveEmbeddingToCloud } = await import('../AIEmbeddingService');

    await expect(saveEmbeddingToCloud('u1', rawEmbedding as never)).rejects.toThrow(/NO_CANONICAL_ID/);
    expect(saveEmbedding).not.toHaveBeenCalled();
  });
});

/**
 * 2026-09-22, продолжение того же класса: documentUuid у записи ЕСТЬ
 * (проставляется в save() сразу, локально), но сам документ ещё не долетел
 * до облака — там та же RLS-политика (`exists(select 1 from documents ...)`)
 * отказывает по факту запроса, а не по отсутствию uuid заранее. Раньше это
 * било в reportError на каждый проход ("new row violates row-level security
 * policy for table \"ai_embeddings\"", код 42501) — тот самый спам из
 * журнала прод-инцидента. Правильный ответ ровно как у "запись без
 * документа" выше: тихо пропустить, не хоронить, отставание само рассосётся,
 * когда сам документ синхронизируется.
 */
describe('RLS-отказ по ещё-не-облачному документу не логируется и не хоронит запись', () => {
  const rlsError = { code: '42501', message: 'new row violates row-level security policy for table "ai_embeddings"' };

  beforeEach(async () => {
    saveEmbedding.mockClear();
    vi.mocked(reportError).mockClear();
    const db = await getLocalDb();
    for (const store of ['documents', 'aiEmbeddings'] as const) {
      for (const r of await db.getAll(store)) {
        await db.delete(store, (r as { id?: string; documentId?: string }).id
          ?? (r as { documentId: string }).documentId);
      }
    }
  });

  it('syncPendingToCloud: не логирует и не помечает cloudSkipped', async () => {
    const db = await getLocalDb();
    await db.put('documents', {
      id: 'local_note_2', uuid: CANON, guestId: 'u1', title: 'Заметка',
      currentVersion: 1, totalWords: 5, totalDuration: 0, sessionsCount: 1,
      firstSessionAt: 1, lastSessionAt: 1, tags: [],
    } as never);
    await db.put('aiEmbeddings', {
      documentId: 'local_note_2', documentUuid: CANON, vectors: [[0.1]], chunkTexts: ['т'],
      model: 'm', dim: 1, contentHash: 'h', processedAt: 1, schemaV: 1,
    } as never);
    saveEmbedding.mockRejectedValueOnce(rlsError);

    const result = await AIEmbeddingService.syncPendingToCloud();

    expect(reportError).not.toHaveBeenCalled();
    expect(result.synced).toBe(0);
    const rec = await db.get('aiEmbeddings', 'local_note_2');
    expect((rec as { cloudSkipped?: boolean; cloudSyncedAt?: number } | undefined)?.cloudSkipped).toBeFalsy();
    expect((rec as { cloudSyncedAt?: number } | undefined)?.cloudSyncedAt).toBeFalsy();
  });

  it('save(): не логирует, запись остаётся pending для последующей выгрузки', async () => {
    const db = await getLocalDb();
    await db.put('documents', {
      id: 'local_note_3', uuid: CANON, guestId: 'u1', title: 'Заметка',
      currentVersion: 1, totalWords: 5, totalDuration: 0, sessionsCount: 1,
      firstSessionAt: 1, lastSessionAt: 1, tags: [],
    } as never);
    saveEmbedding.mockRejectedValueOnce(rlsError);

    await AIEmbeddingService.save({
      documentId: 'local_note_3', vectors: [[0.1]], chunkTexts: ['т'],
      model: 'm', dim: 1, contentHash: 'h', processedAt: 1, schemaV: 1,
    } as never);

    expect(reportError).not.toHaveBeenCalled();
    const rec = await db.get('aiEmbeddings', 'local_note_3');
    expect((rec as { cloudSkipped?: boolean; cloudSyncedAt?: number } | undefined)?.cloudSkipped).toBeFalsy();
    expect((rec as { cloudSyncedAt?: number } | undefined)?.cloudSyncedAt).toBeFalsy();
  });
});
