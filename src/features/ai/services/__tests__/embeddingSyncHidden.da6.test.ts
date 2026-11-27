// DA-6 (проход 27.11): выгрузка векторов снимала список в начале прохода и не
// перечитывала заметку перед каждой выгрузкой. Скрыли вторую, пока выгружалась
// первая, — её вектор всё равно уходил в облако. Настоящий AIEmbeddingService над
// IndexedDB; подменено облако.
// Мутация: снять перечитку перед выгрузкой — красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

const h = vi.hoisted(() => ({ saved: [] as string[] }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/auth', async importActual => ({ ...(await importActual<object>()), getCurrentUser: () => ({ uid: 'u-da6' }) }));
vi.mock('../../../../core/crypto/cryptoHelpers', async importActual => ({
  ...(await importActual<object>()),
  maybeEncrypt: vi.fn(async (payload: Record<string, unknown>) => payload),
}));
vi.mock('../../../../core/data', () => ({
  DataProvider: {
    saveEmbedding: vi.fn(async (_uid: string, id: string) => {
      h.saved.push(id);
      // Пока выгружается первая, вторую скрывают от ИИ.
      if (id === 'uuid-a') {
        const { getLocalDb } = await import('../../../../core/storage/localDb');
        const db = await getLocalDb();
        await db.put('documents', { ...(await db.get('documents', 'b'))!, excludedFromAI: true } as never);
      }
    }),
  },
}));

import { AIEmbeddingService } from '../AIEmbeddingService';
import { getLocalDb } from '../../../../core/storage/localDb';

const doc = (id: string) => ({
  id, uuid: `uuid-${id}`, linkedCloudId: `uuid-${id}`, guestId: 'u-da6', title: id, currentVersion: 1,
  totalWords: 1, totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [],
});
const emb = (id: string) => ({
  documentId: id, documentUuid: `uuid-${id}`, vectors: [[1, 0]], chunkTexts: ['MARKER_DA6'], model: 'm', dim: 2,
  contentHash: id, processedAt: 1, schemaV: 1,
});

beforeEach(async () => {
  h.saved.length = 0;
  localStorage.clear();
  const db = await getLocalDb();
  for (const s of ['documents', 'aiEmbeddings'] as const) await db.clear(s);
  for (const id of ['a', 'b']) {
    await db.put('documents', doc(id) as never);
    await db.put('aiEmbeddings', emb(id) as never);
  }
});

describe('DA-6: выгрузка векторов перечитывает видимость перед каждой', () => {
  it('скрыли вторую во время выгрузки первой — вектор второй в облако не ушёл', async () => {
    await AIEmbeddingService.syncPendingToCloud();
    expect(h.saved.some(id => id.includes('a'))).toBe(true);
    expect(h.saved.some(id => id.includes('b'))).toBe(false);
  });
});
