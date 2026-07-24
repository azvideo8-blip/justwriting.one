import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generate, embed, isTransientError } from '../aiProvider';

describe('AG-AI-RETRY: aiProvider transient network error retry', () => {
  const originalEnv = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env.OPENROUTER_API_KEY = originalEnv;
  });

  it('classifies transient error patterns correctly', () => {
    expect(isTransientError(new Error('read ECONNRESET'))).toBe(true);
    expect(isTransientError(new TypeError('terminated'))).toBe(true);
    expect(isTransientError(new Error('connect ETIMEDOUT'))).toBe(true);
    expect(isTransientError(new Error('socket hang up'))).toBe(true);
    expect(isTransientError(new Error('fetch failed'))).toBe(true);

    // Timeout (didTimeout = true) is NOT transient
    expect(isTransientError(new Error('The operation was aborted'), true)).toBe(false);
    expect(isTransientError(new Error('Generic application error'), false)).toBe(false);
  });

  it('retries when fetch throws ECONNRESET once and succeeds on 2nd attempt', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('read ECONNRESET'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: 'Hello after retry' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }), { status: 200 }));

    vi.stubGlobal('fetch', fetchMock);

    const result = await generate({
      messages: [{ role: 'user', content: 'hi' }],
      abortMs: 30_000,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.text).toBe('Hello after retry');
  });

  it('propropagates transient error after MAX_ATTEMPTS (3 attempts)', async () => {
    const econnresetErr = new Error('read ECONNRESET');
    const fetchMock = vi.fn().mockRejectedValue(econnresetErr);

    vi.stubGlobal('fetch', fetchMock);

    await expect(generate({
      messages: [{ role: 'user', content: 'hi' }],
      abortMs: 30_000,
    })).rejects.toThrow('read ECONNRESET');

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry on own timeout (didTimeout)', async () => {
    const fetchMock = vi.fn().mockImplementation((_url, options) => {
      return new Promise((_resolve, reject) => {
        const signal = options?.signal as AbortSignal;
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    const start = Date.now();
    await expect(generate({
      messages: [{ role: 'user', content: 'hi' }],
      abortMs: 50, // short timeout
    })).rejects.toThrow();

    // Must attempt only ONCE because own timeout fired
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('skips retry when remaining deadline budget is < 10s', async () => {
    let attemptCount = 0;
    let currentTime = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => currentTime);

    const fetchMock = vi.fn().mockImplementation(async () => {
      attemptCount++;
      if (attemptCount === 1) {
        // Advance elapsed time by 25 seconds during attempt 1
        currentTime += 25_000;
      }
      throw new Error('read ECONNRESET');
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(
      generate({
        messages: [{ role: 'user', content: 'hi' }],
        abortMs: 30_000, // Total deadline 30s
      })
    ).rejects.toThrow('read ECONNRESET');

    // Attempt 1 took 25s of 30s total budget -> remaining 5s (< 10s threshold).
    // Retry attempt 2 must be skipped!
    expect(attemptCount).toBe(1);
  });

  it('maintains existing retry behavior for HTTP 502/503/504 status codes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: 'Recovered from 502' } }],
      }), { status: 200 }));

    vi.stubGlobal('fetch', fetchMock);

    const result = await generate({
      messages: [{ role: 'user', content: 'hi' }],
      abortMs: 30_000,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.text).toBe('Recovered from 502');
  });

  it('retries embed OpenRouter on transient network error', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('connect ETIMEDOUT'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
        usage: { total_tokens: 8 },
      }), { status: 200 }));

    vi.stubGlobal('fetch', fetchMock);

    const result = await embed(['test text']);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.vectors).toEqual([[0.1, 0.2, 0.3]]);
  });
});
