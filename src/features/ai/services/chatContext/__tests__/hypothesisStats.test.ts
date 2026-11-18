// Разбор 18.11: просьба о гипотезах, служебный вызов опор был, а блока опор в
// ходе нет — по журналу не понять, на каком шаге они потерялись. Счётчики шагов
// (только числа) едут на сервер в [chat-shape].
// Мутация, на которой тест краснеет: не заполнять stats.diverse / stats.shown.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/retrieval/docSnapshot', () => ({ loadAnalysedIds: async () => new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g']) }));
vi.mock('../../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { buildHypothesisBlock } from '../hypothesisTurn';
import type { HypoStats } from '../../../../../shared/ai/chatShape';

const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const docs = ids.map((id, i) => ({ id, title: id, lastSessionAt: Date.UTC(2026, i, 3) }));
const db = { getAll: async (store: string) => (store === 'documents' ? docs : []) } as never;

async function run(vec: (i: number) => number[]) {
  const emb = ids.map((id, i) => ({ documentId: id, chunkTexts: [`запись ${id}.`], vectors: [vec(i)] }));
  const stats: HypoStats = { cands: 0, picked: 0, quoted: 0, diverse: 0, shown: 0 };
  const block = await buildHypothesisBlock({
    text: 'почему так?', turnEmb: [1, 0, 0], db, minTime: undefined, maxTime: undefined, injectedDocumentIds: [],
    allEmbeddings: emb as never, enabled: async () => true, pick: async () => [{ documentId: 'a' }, { documentId: 'c' }, { documentId: 'e' }] as never, stats,
  });
  return { block, stats };
}

describe('счётчики шагов подбора опор', () => {
  it('опоры об одном и том же — фильтр «о разном» оставляет одну, блока нет', async () => {
    const { block, stats } = await run(i => [1, 0.001 * i, 0]);
    expect(block).toBeNull();
    expect(stats).toEqual({ cands: 7, picked: 3, quoted: 3, diverse: 1, shown: 0 });
  });
  it('опоры о разном — блок из трёх', async () => {
    const { block, stats } = await run(i => (i === 0 ? [1, 1, 0] : i === 2 ? [1, -1, 0] : i === 4 ? [1, 0, 1] : [1, 0.001 * i, 0]));
    expect(block).not.toBeNull();
    expect(stats).toEqual({ cands: 7, picked: 3, quoted: 3, diverse: 3, shown: 3 });
  });
});
