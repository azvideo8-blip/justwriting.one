// R7Q-034: `/auth` на проде держит лимит 5 запросов в минуту, а смоук входа
// делает два и стартует сразу после выкатки. Проверка: 429 обязан читаться как
// «повтори позже», а не как «вход не работает» — и особенно не как «проверка
// неверного пароля пройдена» (под 429 на странице тоже есть [role=alert]).
import { describe, it, expect, vi } from 'vitest';
import {
  classifyAttempt, backoffMs, withRateLimitRetry, RATE_LIMIT_EXIT, BACKOFF_MS,
} from '../post-deploy-login';

describe('R7Q-034: 429 — это не отказ входа', () => {
  it('страница с сообщением «слишком много попыток» — не успех, а лимит', () => {
    expect(classifyAttempt({ succeeded: true, saw429: false, alertText: 'Слишком много попыток. Подожди минуту перед следующей попыткой.' }))
      .toBe('rate_limited');
  });

  it('ответ 429 от /auth перекрывает даже удавшийся вход', () => {
    expect(classifyAttempt({ succeeded: true, saw429: true, alertText: null })).toBe('rate_limited');
  });

  it('обычный отказ — failed, обычный успех — ok', () => {
    expect(classifyAttempt({ succeeded: true, saw429: false, alertText: null })).toBe('ok');
    expect(classifyAttempt({ succeeded: false, saw429: false, alertText: 'Неверный email или пароль.' })).toBe('failed');
  });

  it('ступени ожидания покрывают окно лимита (60 с) с запасом', () => {
    expect(backoffMs(0)).toBe(20_000);
    expect(backoffMs(1)).toBeGreaterThanOrEqual(60_000);
    expect(backoffMs(9)).toBe(BACKOFF_MS[BACKOFF_MS.length - 1]);
  });

  it('повторы только по лимиту: 429, 429, успех = три прохода и два ожидания', async () => {
    const run = vi.fn<() => Promise<{ outcome: 'ok' | 'failed' | 'rate_limited' }>>()
      .mockResolvedValueOnce({ outcome: 'rate_limited' })
      .mockResolvedValueOnce({ outcome: 'rate_limited' })
      .mockResolvedValueOnce({ outcome: 'ok' });
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const r = await withRateLimitRetry(run, sleep);
    expect(r.outcome).toBe('ok');
    expect(run).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(c => c[0])).toEqual([20_000, 65_000]);
  });

  it('отказ продукта не повторяется бесконечно', async () => {
    const run = vi.fn().mockResolvedValue({ outcome: 'failed', detail: 'вход не состоялся' });
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const r = await withRateLimitRetry(run, sleep);
    expect(r.outcome).toBe('failed');
    expect(run).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('исчерпанные повторы остаются rate_limited, и это отдельный код выхода', async () => {
    const run = vi.fn().mockResolvedValue({ outcome: 'rate_limited' });
    const r = await withRateLimitRetry(run, async () => {}, () => {});
    expect(r.outcome).toBe('rate_limited');
    expect(run).toHaveBeenCalledTimes(BACKOFF_MS.length + 1);
    expect(RATE_LIMIT_EXIT).toBe(75);
  });
});
