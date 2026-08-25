// Проверка возврата слота падала на КАЖДОЙ выкатке и печатала «принято»:
// `/api/getAIUsageStats` отвечает конвертом `{ result: { events: [...] } }`
// (api/handlers.ts), а читали `json.events` — всегда undefined. Ошибка при этом
// не влияла на итог, потому что success считался до неё.
// Фальсификация: вернуть чтение `json.events` напрямую — первый тест краснеет.
import { describe, it, expect } from 'vitest';
import { usedFromStatsBody } from '../post-deploy-smoke';

describe('post-deploy smoke: чтение счётчика из ответа', () => {
  it('читает used через конверт result — форма, которую реально отдаёт API', () => {
    expect(usedFromStatsBody({ result: { events: [{ used: 7 }] } })).toBe(7);
  });

  it('поддерживает и форму без конверта', () => {
    expect(usedFromStatsBody({ events: [{ used: 0 }] })).toBe(0);
  });

  it('бросает, а не возвращает мусор, когда used нет', () => {
    expect(() => usedFromStatsBody({ result: { events: [] } })).toThrow(/без used/);
    expect(() => usedFromStatsBody(null)).toThrow(/без used/);
    expect(() => usedFromStatsBody({ error: { code: 'permission-denied' } })).toThrow(/без used/);
  });
});
