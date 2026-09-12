import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Коды отказов в том виде, в каком их шлёт НАША служба на VPS.
 *
 * `api/handlers.ts` отдаёт `{ error: { code, message } }` с чистым кодом —
 * 'resource-exhausted', 'unauthenticated', 'invalid-argument'. Разбор ошибок
 * при этом остался с времён Firebase и сравнивал с 'functions/resource-exhausted',
 * поэтому после переезда каждый отказ по лимиту становился SERVER_ERROR: и
 * «подождите минуту», и «лимит на сегодня исчерпан» выглядели поломкой сервиса,
 * а ветки, которые на эти коды рассчитывали, не срабатывали никогда.
 *
 * Тесты ниже кормят ровно тот формат, который приходит по проводу.
 */

const mockCallAi = vi.fn();
vi.mock('../../../../core/ai/callAi', () => ({ callAi: (...a: unknown[]) => mockCallAi(...a) }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u1' }), getIdToken: async () => 't' }));
vi.mock('../../../../shared/utils/analytics', () => ({ analytics: { track: vi.fn() } }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const { AIService } = await import('../AIService');

/** Отказ в том виде, в каком его собирает callAi из ответа службы. */
function wireError(code: string, message: string, status: number) {
  return Object.assign(new Error(message), { code, status });
}

describe('разбор кодов отказа в формате VPS-службы', () => {
  beforeEach(() => vi.clearAllMocks());

  it('минутное окно читается как ограничение частоты, а не поломка', async () => {
    mockCallAi.mockRejectedValue(
      wireError('resource-exhausted', 'Too many requests. Please wait a minute.', 429),
    );

    expect(await AIService.embed({ content: 'текст' })).toEqual({ ok: false, error: 'RATE_LIMIT' });
  });

  it('исчерпанный фоновый лимит читается как дневной, а не как «подождите минуту»', async () => {
    mockCallAi.mockRejectedValue(
      wireError('resource-exhausted', 'Daily bulk operations limit reached.', 429),
    );

    expect(await AIService.embed({ content: 'текст' })).toEqual({ ok: false, error: 'DAILY_LIMIT' });
  });

  it('исчерпанный дневной лимит человека читается как дневной', async () => {
    mockCallAi.mockRejectedValue(wireError('resource-exhausted', 'Daily limit reached.', 429));

    expect(await AIService.embed({ content: 'текст' })).toEqual({ ok: false, error: 'DAILY_LIMIT' });
  });

  /**
   * nginx режет запросы на краю и отдаёт 429 своей страницей, без JSON. Тела с
   * кодом нет — значит опознать отказ можно только по статусу.
   */
  it('отказ с края без тела читается как ограничение частоты', async () => {
    mockCallAi.mockRejectedValue(
      Object.assign(new Error('AI request failed'), { code: 'resource-exhausted', status: 429 }),
    );

    expect(await AIService.embed({ content: 'текст' })).toEqual({ ok: false, error: 'RATE_LIMIT' });
  });

  it('отсутствие авторизации читается как отсутствие авторизации', async () => {
    mockCallAi.mockRejectedValue(wireError('unauthenticated', 'Missing token.', 401));

    expect(await AIService.embed({ content: 'текст' })).toEqual({ ok: false, error: 'AUTH_REQUIRED' });
  });

  it('настоящая поломка службы остаётся поломкой', async () => {
    mockCallAi.mockRejectedValue(wireError('internal', 'Internal server error.', 500));

    expect(await AIService.embed({ content: 'текст' })).toEqual({ ok: false, error: 'SERVER_ERROR' });
  });

  it('сводка отдаёт те же коды, что и вектор — на них смотрит проход по архиву', async () => {
    mockCallAi.mockRejectedValue(
      wireError('resource-exhausted', 'Too many requests. Please wait a minute.', 429),
    );
    expect(await AIService.summarize({ content: 'текст' })).toEqual({ ok: false, error: 'RATE_LIMIT' });

    mockCallAi.mockRejectedValue(
      wireError('resource-exhausted', 'Daily bulk operations limit reached.', 429),
    );
    expect(await AIService.summarize({ content: 'текст' })).toEqual({ ok: false, error: 'DAILY_LIMIT' });
  });

  it('RC-4: 503 с SERVICE_UNAVAILABLE читается как SERVICE_UNAVAILABLE', async () => {
    mockCallAi.mockRejectedValue(wireError('SERVICE_UNAVAILABLE', 'could not check limit', 503));
    expect(await AIService.embed({ content: 'текст' })).toEqual({ ok: false, error: 'SERVICE_UNAVAILABLE' });
  });

  it('RC-4: 503 с HTML-телом или другим кодом читается как UPSTREAM', async () => {
    mockCallAi.mockRejectedValue(wireError('unavailable', '<html>503 Bad Gateway</html>', 503));
    expect(await AIService.embed({ content: 'текст' })).toEqual({ ok: false, error: 'UPSTREAM' });

    mockCallAi.mockRejectedValue(wireError('other_code', 'Some error', 503));
    expect(await AIService.embed({ content: 'текст' })).toEqual({ ok: false, error: 'UPSTREAM' });
  });
});
