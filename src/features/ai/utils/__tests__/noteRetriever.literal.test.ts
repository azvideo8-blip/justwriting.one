// TEST-1 §2.4: a word with a cut-off ending is NOT a literal match by itself;
// «про Сашу» still finds «Сашей» via the two-letter stem on a word boundary.
// TEST-1 §2.5: RRF scores are normalised to [0..1] before weights apply.
import { describe, expect, it } from 'vitest';
import { findLiteralMatches, vectorScore01 } from '../noteRetriever';

// LocalVersionService reads IndexedDB — stub the module to feed contents.
vi.mock('../../../../core/services/LocalVersionService', () => ({
  LocalVersionService: {
    getLatestContent: vi.fn(async (id: string) => CONTENTS[id] ?? ''),
    getLatestVersionMeta: vi.fn(async () => null),
  },
}));
import { vi } from 'vitest';

const CONTENTS: Record<string, string> = {
  // «конь» и «поклон» содержат подстроку «он», но не словоформы имени «Она».
  horse: 'Белый конь стоял у поклона.',
  // «Сашей» — падежная форма; стем «Саш» матчится на границе слова.
  sasha: 'Мы гуляли с Сашей по набережной.',
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
