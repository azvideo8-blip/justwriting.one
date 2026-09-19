// plan-2026-09-19-local-embeddings, task 1: embed() must hit AI_EMBED_BASE_URL
// when set, and fall back to the shared AI_BASE_URL when it isn't — so chat
// (generateOpenRouter, api/chat.ts) keeps using AI_BASE_URL untouched either way.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

function mockFetchOnce() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      data: [{ embedding: [0.1, 0.2] }],
      usage: { total_tokens: 3 },
    }),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV, OPENROUTER_API_KEY: 'test-key' };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe('embed() base URL', () => {
  it('uses AI_EMBED_BASE_URL when set, not the shared AI_BASE_URL', async () => {
    process.env.AI_BASE_URL = 'https://routerai.ru/api/v1';
    process.env.AI_EMBED_BASE_URL = 'http://localhost:8080/v1';
    const fetchMock = mockFetchOnce();

    const { embed } = await import('../provider');
    await embed(['привет']);

    const calledUrl = fetchMock.mock.calls[0]![0] as string;
    expect(calledUrl).toBe('http://localhost:8080/v1/embeddings');
  });

  it('falls back to the shared AI_BASE_URL when AI_EMBED_BASE_URL is unset', async () => {
    process.env.AI_BASE_URL = 'https://routerai.ru/api/v1';
    delete process.env.AI_EMBED_BASE_URL;
    const fetchMock = mockFetchOnce();

    const { embed } = await import('../provider');
    await embed(['привет']);

    const calledUrl = fetchMock.mock.calls[0]![0] as string;
    expect(calledUrl).toBe('https://routerai.ru/api/v1/embeddings');
  });
});
