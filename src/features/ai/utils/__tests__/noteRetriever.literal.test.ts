// TEST-1 §2.4: a word with a cut-off ending is NOT a literal match by itself;
// «про Сашу» still finds «Сашей» via the two-letter stem on a word boundary.
// TEST-1 §2.5: RRF scores are normalised to [0..1] before weights apply.
import { describe, expect, it, vi } from 'vitest';
import { findLiteralMatches, vectorScore01 } from '../noteRetriever';

// LocalVersionService reads IndexedDB — stub the module to feed contents.
vi.mock('../../../../core/services/LocalVersionService', () => ({
  LocalVersionService: {
    getLatestContent: vi.fn(async (id: string) => CONTENTS[id] ?? ''),
    getLatestVersionMeta: vi.fn(async () => null),
  },
}));

const CONTENTS: Record<string, string> = {
  // «конь» и «поклон» содержат подстроку «он», но не словоформы имени «Она».
  horse: 'Белый конь стоял у поклона.',
  // «Сашей» — падежная форма; стем «Саш» матчится на границе слова.
  sasha: 'Мы гуляли с Сашей по набережной.',
  // «Ольгой» → однобуквенный стем «Ольго» не совпадает ни с чем в этом тексте,
  // двухбуквенный «Ольг» находит «Ольге». Единственный различающий случай.
  olga: 'Вчера позвонил Ольге насчёт работы.',
  empty: '',
};

describe('2.4 findLiteralMatches', () => {
  it('«Она» alone does not match text merely containing «конь»/«поклон»', async () => {
    const hits = await findLiteralMatches('Она сказала', ['horse']);
    expect(hits.has('horse')).toBe(false);
  });

  it('«про Сашу» matches «Сашей» via the stem on a word boundary', async () => {
    const hits = await findLiteralMatches('Разговор про Сашу', ['sasha']);
    expect(hits.has('sasha')).toBe(true);
  });

  // Проверка именно на второй, короткий стем: сущность ≥6 букв, где обрезка
  // одной буквы промахивается. Без неё тест проходил и на прежнем стеммере —
  // «Сашу» короткая, и ветка slice(0,-2) в ней не участвует вовсе.
  it('«Ольгой» matches «Ольге» via the two-letter stem', async () => {
    // В запросе ровно одна именованная сущность. С «Разговор с Ольгой» тест
    // проходил и на прежнем стеммере: «Разговор» — тоже сущность, и совпадение
    // приходило от неё, а не от имени.
    const hits = await findLiteralMatches('встреча с Ольгой', ['olga']);
    expect(hits.has('olga')).toBe(true);
  });

  it('a short capitalised word («Он») is not treated as a named entity', async () => {
    const hits = await findLiteralMatches('Он пришёл', ['horse']);
    expect(hits.size).toBe(0);
  });
});

describe('2.5 vectorScore01 normalisation', () => {
  it('typical RRF ceiling (~0.05) maps near 1, not ~0.05', () => {
    expect(vectorScore01(0.05)).toBe(1);
    expect(vectorScore01(0.03)).toBeCloseTo(0.6, 5);
  });

  it('clamps negatives to 0 and saturates above 0.05', () => {
    expect(vectorScore01(-1)).toBe(0);
    expect(vectorScore01(0)).toBe(0);
    expect(vectorScore01(10)).toBe(1);
  });
});
