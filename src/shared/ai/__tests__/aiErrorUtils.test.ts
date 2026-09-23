import { describe, it, expect } from 'vitest';
import { aiErrorToText } from '../aiErrorUtils';

describe('aiErrorToText', () => {
  it('distinguishes RATE_LIMIT from DAILY_LIMIT without t', () => {
    const rateLimit = aiErrorToText('RATE_LIMIT');
    const dailyLimit = aiErrorToText('DAILY_LIMIT');

    expect(rateLimit).not.toBe(dailyLimit);
    expect(rateLimit).toContain('Слишком частые запросы');
    expect(dailyLimit).toContain('Дневной лимит');
  });

  it('distinguishes RATE_LIMIT from DAILY_LIMIT with t', () => {
    const fakeT = (k: string) => {
      if (k === 'ai_error_rate_limit') return 'Too many requests. Wait a minute.';
      if (k === 'ai_error_daily_limit') return 'Daily limit reached. Try again tomorrow.';
      return k;
    };

    const rateLimit = aiErrorToText('RATE_LIMIT', { t: fakeT });
    const dailyLimit = aiErrorToText('DAILY_LIMIT', { t: fakeT });

    expect(rateLimit).not.toBe(dailyLimit);
    expect(rateLimit).toBe('Too many requests. Wait a minute.');
    expect(dailyLimit).toBe('Daily limit reached. Try again tomorrow.');
  });

  it('handles auth states properly based on login status', () => {
    const loggedIn = aiErrorToText('AUTH_REQUIRED', { isLoggedIn: true });
    const guest = aiErrorToText('AUTH_REQUIRED', { isLoggedIn: false });

    expect(loggedIn).toContain('сессию');
    expect(guest).toContain('регистрация');
  });

  it('formats RATE_LIMIT with remaining seconds (F-8)', () => {
    const formatted = aiErrorToText('RATE_LIMIT:6');
    expect(formatted).toBe('Слишком частые запросы. Подождите 6 сек. перед следующей отправкой.');
  });

  it('formats BULK_LIMIT with truthful explanation (F-1)', () => {
    const formatted = aiErrorToText('BULK_LIMIT');
    expect(formatted).toBe('Фоновый лимит ИИ на сегодня исчерпан (разбор, поиск по смыслу) — чат по-прежнему работает');
  });
});
