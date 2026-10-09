// П-4 (08.10.2026): у лёгкого поиска появился порог — 0,50 по исходному косинусу.
//
// Блок «Возможно релевантные заметки» брал топ-3 без всякого порога. На запросах,
// где ответа в архиве нет, это чистый шум: 3,6 заметки на none-запрос в замере
// 08.10. Порог 0,50 — единственная правка порога, выигравшая на обеих половинах
// разметки (мусор 0,83 → 0,82, none-заметки 3,58 → 2,75, релевантные в контексте
// 0,40 → 0,39). Поднимать RESURFACE_FLOOR (0,45/0,50) замер запретил: проигрыш на
// обеих половинах.
//
// Мутация, на которой тест краснеет: убрать `.filter(... >= LITE_FLOOR)` в
// `liteRetrieval.ts` → красный на «0,46 не попадает» и на «всё ниже порога → null».
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { buildLiteRetrievalBlock } from '../liteRetrieval';
import { AIEmbeddingService } from '../../AIEmbeddingService';
import { getLocalDb } from '../../../../../core/storage/localDb';

vi.mock('../../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const TURN = [1, 0, 0];
/** вектор с косинусом c против TURN */
const vec = (c: number): number[] => [c, Math.sqrt(Math.max(0, 1 - c * c)), 0];

async function seed(idsWithScore: Array<[string, number]>) {
  const db = await getLocalDb();
  await db.clear('documents');
  await db.clear('aiEmbeddings');
  for (const [id, cos] of idsWithScore) {
    await db.put('documents', {
      id, guestId: 'u1', title: `Заметка ${id}`, currentVersion: 1, totalWords: 30, totalDuration: 0,
      sessionsCount: 1, firstSessionAt: 1000, lastSessionAt: 1000, tags: [],
    } as never);
    await db.put('aiEmbeddings', {
      documentId: id, vectors: [vec(cos)], chunkTexts: [`Кусок заметки ${id} про проект Альфа`],
      contentHash: `h-${id}`, processedAt: 1, model: 'm', dim: 3,
    } as never);
  }
  return db;
}

function run(db: Awaited<ReturnType<typeof getLocalDb>>) {
  const injected: string[] = [];
  return {
    injected,
    block: buildLiteRetrievalBlock({ turnEmb: TURN, db, minTime: undefined, maxTime: undefined, injectedDocumentIds: injected }),
  };
}

describe('П-4: порог лёгкого поиска 0,50', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('косинус 0,58 попадает в блок, 0,46 — нет', async () => {
    const db = await seed([['local_p4_hi', 0.58], ['local_p4_lo', 0.46]]);
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([
      { documentId: 'local_p4_hi', vectors: [vec(0.58)], chunkTexts: ['Кусок заметки local_p4_hi про проект Альфа'], contentHash: 'a', processedAt: 1, model: 'm', dim: 3 },
      { documentId: 'local_p4_lo', vectors: [vec(0.46)], chunkTexts: ['Кусок заметки local_p4_lo про проект Альфа'], contentHash: 'b', processedAt: 1, model: 'm', dim: 3 },
    ] as never);
    const { block, injected } = run(db);
    const text = await block;

    expect(text).not.toBeNull();
    expect(text).toContain('local_p4_hi');
    expect(text).not.toContain('local_p4_lo');
    expect(injected).toEqual(['local_p4_hi']);
  });

  it('если всё ниже порога — блока нет вовсе', async () => {
    const db = await seed([['local_p4_a', 0.44], ['local_p4_b', 0.41], ['local_p4_c', 0.39]]);
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([
      { documentId: 'local_p4_a', vectors: [vec(0.44)], chunkTexts: ['Кусок A'], contentHash: 'a', processedAt: 1, model: 'm', dim: 3 },
      { documentId: 'local_p4_b', vectors: [vec(0.41)], chunkTexts: ['Кусок B'], contentHash: 'b', processedAt: 1, model: 'm', dim: 3 },
      { documentId: 'local_p4_c', vectors: [vec(0.39)], chunkTexts: ['Кусок C'], contentHash: 'c', processedAt: 1, model: 'm', dim: 3 },
    ] as never);
    const { block, injected } = run(db);

    expect(await block).toBeNull();
    expect(injected).toEqual([]);
  });

  it('константа порога экспортируется и равна 0,50', async () => {
    const t = await import('../../../utils/retrieval/types');
    expect(t.LITE_FLOOR).toBe(0.5);
  });
});
