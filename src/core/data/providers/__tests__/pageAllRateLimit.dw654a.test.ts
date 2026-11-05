// DW6-5.4 (находка ревью 0.11.6): общий тормоз 429 висел ВОКРУГ всего постраничного
// забора. `withRateLimitRetry(() => DocumentService.getUserDocuments(uid))` при 429
// на странице N повторял ВЫЗОВ ЦЕЛИКОМ, то есть перечитывал страницы 0…N−1 — на
// длинном заборе это заново прочитанные тысячи строк и ход по кругу. Повтор обязан
// касаться одной страницы.
//
// Мутации: вернуть `buildQuery` без обёртки — краснеет кейс 1 (забор падает на
// первом же 429); заодно кейс 2 не даёт превратить в повтор ВСЕ ошибки.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pageAll, type PageQueryResult } from '../pageAll';
import { rateLimitTuning } from '../../../services/rateGate';

// Форма 429 с живого nginx-ответа: в объекте ошибки только `message` (реальное
// распознавание — `isRateLimitedError`, оно смотрит текст).
const RATE_LIMITED = () => new Error('<html><head><title>503</title></head><body>Too Many Requests</body></html>');
const realTuning = { ...rateLimitTuning };

beforeEach(() => {
  rateLimitTuning.baseMs = 1;
  rateLimitTuning.maxMs = 1;
});

afterEach(() => {
  Object.assign(rateLimitTuning, realTuning);
});

describe('DW6-5.4: 429 внутри постраничного забора повторяет страницу', () => {
  it('429 на второй странице: повтор второй страницы, нулевая прочитана один раз', async () => {
    const seen: number[] = [];
    let refused = false;
    const buildQuery = async (from: number): Promise<PageQueryResult<{ id: number }>> => {
      seen.push(from);
      if (from === 2 && !refused) {
        refused = true;
        return { data: null, error: RATE_LIMITED() };
      }
      return { data: from < 4 ? [{ id: from }, { id: from + 1 }] : [], error: null };
    };

    const all = await pageAll(buildQuery, 2);

    expect(all.map(r => r.id)).toEqual([0, 1, 2, 3]);
    expect(seen, 'список перечитан с нулевой страницы').toEqual([0, 2, 2, 4]);
  });

  it('обычная ошибка чтения не повторяется и уходит вызывающему', async () => {
    const seen: number[] = [];

    await expect(pageAll(async (from: number) => {
      seen.push(from);
      return { data: null, error: new Error('DECRYPT_FAILED_LATEST: version 429') };
    }, 2)).rejects.toThrow('DECRYPT_FAILED_LATEST');

    expect(seen, 'не 429 повторяется — тормоз наложен не на тот признак').toEqual([0]);
  });
});
