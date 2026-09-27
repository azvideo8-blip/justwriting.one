// SA-2: стриминговый путь (/api/chat) — не через callAi, и он терял заголовок
// статуса: сервер сказал «не смог прочитать лимиты», а до store это не доезжало.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const store: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
});

vi.mock('../../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: 'u1' }),
  getIdToken: async () => 'tok',
}));
vi.mock('../../../../core/ai/aiConsent', () => ({
  getAiConsent: () => true,
  isProfileLoaded: () => true,
}));

import { streamChat } from '../aiChatTransport';
import { useAiLimitStore } from '../../store/useAiLimitStore';

function sseRes(headers: Record<string, string>): Response {
  return new Response('ответ', { status: 200, headers });
}

beforeEach(() => {
  useAiLimitStore.setState({ used: 3, limit: 30, remaining: 27, reconciled: true, limitUnknown: false });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('SA-2: streamChat отдаёт статус квоты в store', () => {
  it('unavailable по стриму поднимает отметку и снимает подтверждение', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseRes({ 'X-AI-Quota-Status': 'unavailable' })));
    await streamChat({
      personaId: 'cbt', messages: [{ role: 'user', content: 'привет', type: 'chat' }],
      onChunk: () => {},
    });

    const s = useAiLimitStore.getState();
    expect(s.limitUnknown).toBe(true);
    expect(s.reconciled).toBe(false);
    expect(s.used).toBe(3);
  });

  it('обычные заголовки с числами работают как раньше', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseRes({
      'X-AI-Quota-Used': '9', 'X-AI-Quota-Limit': '30',
    })));
    await streamChat({
      personaId: 'cbt', messages: [{ role: 'user', content: 'привет', type: 'chat' }],
      onChunk: () => {},
    });

    const s = useAiLimitStore.getState();
    expect(s.used).toBe(9);
    expect(s.limitUnknown).toBe(false);
  });
});
