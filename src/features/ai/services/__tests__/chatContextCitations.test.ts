import { describe, it, expect } from 'vitest';
import { extractCitationIds, validateCitationIds } from '../../services/chatContext/citations';

describe('extractCitationIds', () => {
  it('извлекает id из [#...] маркеров', () => {
    expect(extractCitationIds('текст [#doc_1] и ещё [#abc-123]')).toEqual(['doc_1', 'abc-123']);
  });

  it('возвращает пустой массив без маркеров', () => {
    expect(extractCitationIds('без цитат')).toEqual([]);
  });

  it('пропускает пустые маркеры', () => {
    expect(extractCitationIds('[#] [#ok]')).toEqual(['ok']);
  });
});

describe('validateCitationIds', () => {
  const lookup = async (id: string) => {
    if (id === 'excluded') return { excludedFromAI: true };
    if (id === 'missing') return undefined;
    if (id === 'boom') throw new Error('db error');
    return { excludedFromAI: false };
  };

  it('оставляет только существующие не-исключённые документы', async () => {
    const ids = ['good', 'excluded', 'missing', 'boom'];
    await expect(validateCitationIds(ids, lookup)).resolves.toEqual(['good']);
  });
});
