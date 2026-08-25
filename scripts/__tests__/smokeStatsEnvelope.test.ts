// Проверка возврата слота падала на КАЖДОЙ выкатке и печатала «принято»:
// `/api/getAIUsageStats` отвечает конвертом `{ result: { events: [...] } }`
// (api/handlers.ts), а читали `json.events` — всегда undefined. Ошибка при этом
// не влияла на итог, потому что success считался до неё.
// Фальсификация: вернуть чтение `json.events` напрямую — первый тест краснеет.
import { describe, it, expect } from 'vitest';
import { usedFromStatsBody, requestFor } from '../post-deploy-smoke';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

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

// Проверка ходит на боевой https-домен, а скрипт звал node:http.request —
// ERR_INVALID_PROTOCOL на первом же запросе, на каждой выкатке.
// Фальсификация: вернуть httpRequest безусловно — первый тест краснеет.
describe('post-deploy smoke: выбор транспорта по протоколу', () => {
  it('для https берёт https.request', () => {
    expect(requestFor('https://justwriting.ru')).toBe(httpsRequest);
  });

  it('для http остаётся http.request', () => {
    expect(requestFor('http://127.0.0.1:3000')).toBe(httpRequest);
  });
});
