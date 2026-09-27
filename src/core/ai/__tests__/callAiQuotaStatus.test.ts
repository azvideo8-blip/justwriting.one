// SA-2 (`ai-store-sync-durability/03`), клиент. Сервер на отказе Postgres
// переставал присылать X-AI-Quota-* вовсе, а syncFromHeaders на отсутствии
// заголовка выходил молча — прошлое подтверждённое число оставалось на экране
// как нынешнее. Теперь сервер говорит «unavailable», и это обязано доходить до
// store: число перестаёт считаться подтверждённым, а следом и показываться.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callAi, onAiQuotaHeaders } from '../callAi';
import { setAiConsent, useAiConsentStore } from '../aiConsent';
import { setProfileLoaded } from '../../crypto/cryptoHelpers';
import * as auth from '../../auth';

vi.mock('../../auth', () => ({
  getIdToken: vi.fn(),
  getCurrentUser: vi.fn(),
}));

function responseWith(headers: Record<string, string>) {
  return {
    ok: true,
    json: () => Promise.resolve({ result: { success: true } }),
    headers: new Headers(headers),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAiConsentStore.setState({ consents: {} });
  setProfileLoaded('user-sa2', true);
  setAiConsent('user-sa2', true);
  vi.mocked(auth.getIdToken).mockResolvedValue('valid-token');
  vi.mocked(auth.getCurrentUser).mockReturnValue({ uid: 'user-sa2' } as never);
});

describe('SA-2: слушатель заголовков квоты слышит и отказ', () => {
  it('X-AI-Quota-Status: без чисел всё равно доходит до подписчика', async () => {
    const seen: string[] = [];
    const off = onAiQuotaHeaders(h => seen.push(h.get('x-ai-quota-status') ?? ''));
    global.fetch = vi.fn().mockResolvedValue(responseWith({ 'x-ai-quota-status': 'unavailable' }));

    await callAi('summarize', { text: 't' });
    off();

    expect(seen).toEqual(['unavailable']);
  });

  it('обычный ответ без заголовков квоты подписчика не будит', async () => {
    const seen: string[] = [];
    const off = onAiQuotaHeaders(h => seen.push(h.get('x-ai-quota-status') ?? ''));
    global.fetch = vi.fn().mockResolvedValue(responseWith({ 'content-type': 'application/json' }));

    await callAi('summarize', { text: 't' });
    off();

    expect(seen).toEqual([]);
  });
});
