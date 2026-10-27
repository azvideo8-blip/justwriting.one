import { describe, expect, it } from 'vitest';
import { parseTemporalQuery } from '../temporalQueryParser';

// PR-8: ветку `person` никто вне парсера не читал — окно поиска она не меняла,
// а обычное существительное после «про/о/с» превращала в имя («про
// сопротивление» → person «Сопротивление»). Ветка удалена.
describe('PR-8: тип person удалён', () => {
  it('обычное существительное после «про» — не имя', () => {
    expect(parseTemporalQuery('расскажи про сопротивление')).toEqual({
      type: 'none',
      rawText: 'расскажи про сопротивление',
    });
  });

  it('имя после «про/о/с» больше не даёт person', () => {
    for (const text of ['расскажи про Ольгу', 'что о Диме я писал', 'встреча с Сашей', 'говорили с Сергеем']) {
      expect(parseTemporalQuery(text).type, text).toBe('none');
    }
  });
});
