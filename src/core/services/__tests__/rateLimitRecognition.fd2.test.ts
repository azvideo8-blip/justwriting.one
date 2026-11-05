import { describe, it, expect } from 'vitest';
import { isRateLimitedError, withRateLimitRetry, rateLimitTuning } from '../rateGate';

/**
 * FD-2: распознавание `429`. Форма — по замеру на стенде (supabase-js 2.118.0),
 * не по памяти: nginx limit_req отдаёт text/html, и в объекте ошибки остаётся
 * только `message` с HTML-страницей — ни `code`, ни `status`, ни `statusCode`.
 * Ошибки PostgREST с кодом (`22P02`, `42501`) в лимит попадать не должны.
 */

const NGINX_HTML = '<html>\r\n<head><title>429 Too Many Requests</title></head>\r\n<body>\r\n<center><b>429 Too Many Requests</b></center>\r\n</body>\r\n</html>\r\n';

describe('FD-2: 429 как «притормози», а не «сбой заметки»', () => {
  it('html-тело nginx (только message) — это лимит', () => {
    expect(isRateLimitedError({ message: NGINX_HTML })).toBe(true);
  });

  it('json-тело с `error` и текстом про rate limit — это лимит', () => {
    expect(isRateLimitedError({ error: 'Too Many Requests', message: 'rate limit exceeded' })).toBe(true);
  });

  it('ошибка PostgREST с другим кодом — НЕ лимит', () => {
    expect(isRateLimitedError({ message: 'invalid input syntax for type uuid: "x"', code: '22P02' })).toBe(false);
    expect(isRateLimitedError({ message: 'row-level security', code: '42501' })).toBe(false);
    // Ревью FD: номер версии 429 в тексте ошибки — не лимит.
    expect(isRateLimitedError({ message: 'DECRYPT_FAILED_LATEST: doc x version 429' })).toBe(false);
  });

  it('повтор тот же, а не пропуск: после двух 429 третья попытка проходит', async () => {
    const saved = { ...rateLimitTuning };
    rateLimitTuning.baseMs = 1;
    rateLimitTuning.maxMs = 2;
    rateLimitTuning.maxAttempts = 5;
    let calls = 0;
    try {
      const res = await withRateLimitRetry(async () => {
        calls++;
        if (calls < 3) throw { message: NGINX_HTML };
        return 'ок';
      });
      expect(res).toBe('ок');
      expect(calls).toBe(3);
    } finally {
      Object.assign(rateLimitTuning, saved);
    }
  });

  it('после исчерпания повторов ошибка уходит наружу — это и есть `failed`', async () => {
    const saved = { ...rateLimitTuning };
    rateLimitTuning.baseMs = 1;
    rateLimitTuning.maxMs = 2;
    rateLimitTuning.maxAttempts = 3;
    let calls = 0;
    try {
      await expect(withRateLimitRetry(async () => {
        calls++;
        throw { message: NGINX_HTML };
      })).rejects.toBeDefined();
      expect(calls).toBe(3);
    } finally {
      Object.assign(rateLimitTuning, saved);
    }
  });

  it('не-лимитная ошибка не повторяется ни разу', async () => {
    const saved = { ...rateLimitTuning };
    rateLimitTuning.baseMs = 1;
    rateLimitTuning.maxAttempts = 5;
    let calls = 0;
    try {
      await expect(withRateLimitRetry(async () => {
        calls++;
        throw { message: 'invalid input syntax', code: '22P02' };
      })).rejects.toBeDefined();
      expect(calls).toBe(1);
    } finally {
      Object.assign(rateLimitTuning, saved);
    }
  });
});
