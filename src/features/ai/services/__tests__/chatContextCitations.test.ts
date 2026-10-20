import { describe, it, expect } from 'vitest';
import { extractCitationIds, validateCitationIds } from '../../services/chatContext/citations';

describe('extractCitationIds', () => {
  it('извлекает id из [#...] маркеров', () => {
    expect(extractCitationIds('текст [#doc_1] и ещё [#abc-123]')).toEqual(['doc_1', 'abc-123']);
  });

  // Приёмка ai-privacy: номер импортированной заметки — с точкой, ссылка бывает
  // с шапкой «· дата». Иначе фильтр скрытых (AP-2) их пропускал.
  // Мутация: вернуть [a-zA-Z0-9_-]+ без точки и без шапки — красный.
  it('видит номер с точкой и ссылку с шапкой «· дата»', () => {
    expect(extractCitationIds('В записи [#1720194283.716586] и [#doc_x · 12 сент.]')).toEqual(['1720194283.716586', 'doc_x']);
  });

  it('и цитата скрытой импортированной заметки заменяется в истории для API', async () => {
    const { citesAnyId } = await import('../../utils/aiChatTransport');
    expect(citesAnyId('В записи [#1720194283.716586 · 10 сент.] ты писал: «МАРКЕР»', new Set(['1720194283.716586']))).toBe(true);
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
