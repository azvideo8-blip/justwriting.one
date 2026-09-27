// SB-4 (`sync-failure-modes/06`). `callAi` ждал ответа вечно: серверный дедлайн
// есть (api/ai/provider.ts:118 — 110 с на generate, api/chat.ts:190 — 120 с на
// стрим), а клиенту он не передавался. `withTimeout` в AIService от этой вечности
// спасает только наполовину: он перестаёт ждать, но fetch живёт дальше — соединение
// и забронированный слот квоты остаются занятыми. И «уйти со страницы» не значило
// ничего: сигнал useAIChat доходил только до стрима, не до callable-повтора.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callAi, AI_REQUEST_TIMEOUT_MS } from '../callAi';
import { setAiConsent, useAiConsentStore } from '../aiConsent';
import { setProfileLoaded } from '../../crypto/cryptoHelpers';
import { TimeoutError } from '../../../shared/utils/withTimeout';
import * as auth from '../../auth';

vi.mock('../../auth', () => ({
  getIdToken: vi.fn(),
  getCurrentUser: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  useAiConsentStore.setState({ consents: {} });
  setProfileLoaded('user-sb4', true);
  setAiConsent('user-sb4', true);
  vi.mocked(auth.getIdToken).mockResolvedValue('valid-token');
  vi.mocked(auth.getCurrentUser).mockReturnValue({ uid: 'user-sb4' } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

/** fetch, который никогда не отвечает: ровно то, что делает зависший провайдер. */
function hangingFetch() {
  const fn = vi.fn((..._args: [string, RequestInit?]): Promise<never> => new Promise<never>(() => {}));
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

/** Чем закончился промис за `ms` фиксированного времени: 'pending' или ошибка. */
async function outcome(promise: Promise<unknown>, ms: number): Promise<'pending' | { error?: unknown }> {
  const box: { error?: unknown; done?: boolean } = {};
  void promise.then(() => { box.done = true; }, (e: unknown) => { box.error = e; box.done = true; });
  await vi.advanceTimersByTimeAsync(ms);
  return box.done ? box : 'pending';
}

describe('SB-4: у вызова ИИ есть клиентский потолок и отмена', () => {
  it('запрос уходит с AbortSignal', async () => {
    const fetchMock = hangingFetch();
    void callAi('summarize', { text: 't' });
    await vi.advanceTimersByTimeAsync(0);

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('зависший ответ обрывается на потолке и отдаётся TimeoutError', async () => {
    hangingFetch();
    const res = await outcome(callAi('summarize', { text: 't' }), AI_REQUEST_TIMEOUT_MS + 5_000);
    expect(res).not.toBe('pending');
    expect((res as { error?: unknown }).error).toBeInstanceOf(TimeoutError);
  });

  it('потолок больше серверного дедлайна: легитимный ответ не режется', () => {
    // generate() на сервере — 110 с, гонка AIService — 115 с; клиентский потолок
    // обязан переживать оба, иначе он обрывал бы то, что раньше доходило.
    expect(AI_REQUEST_TIMEOUT_MS).toBeGreaterThan(115_000);
    expect(AI_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(150_000);
  });

  it('отмена звонящего доходит до fetch', async () => {
    const fetchMock = hangingFetch();
    const controller = new AbortController();
    const box: { error?: unknown } = {};
    void callAi('summarize', { text: 't' }, { signal: controller.signal }).catch(e => { box.error = e; });
    await vi.advanceTimersByTimeAsync(0);

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);

    expect((fetchMock.mock.calls[0]?.[1] as { signal: AbortSignal }).signal.aborted).toBe(true);
    expect(box.error).toBeDefined();
  });

  it('окно даётся каждому вызову своё: прошлый таймер не съедает повтор', async () => {
    hangingFetch();
    const first = await outcome(callAi('summarize', { text: 't' }), AI_REQUEST_TIMEOUT_MS + 1_000);
    expect((first as { error?: unknown }).error).toBeInstanceOf(TimeoutError);

    // Повтор стартует с чистого окна: через минуту после него запрос ещё жив.
    const second = await outcome(callAi('summarize', { text: 't' }), 60_000);
    expect(second).toBe('pending');
  });
});
