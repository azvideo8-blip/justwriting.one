import { beforeEach, describe, expect, it, vi } from 'vitest';

// DLG-Q3: кризисный ход уезжает на сервер отдельным полем. Если флаг потеряется
// в транспорте, модель получит обычный промпт: телефоны хоть и в SAFETY_GUIDE,
// но сигнала «этот ход кризисный» не будет, и архив поедет в кризисный ответ.

vi.mock('../../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: 'u_q3' }),
  getIdToken: async () => 'id-token',
}));
vi.mock('../../../../core/ai/aiConsent', () => ({
  isProfileLoaded: () => true,
  getAiConsent: () => true,
}));

import { AIService } from '../../services/AIService';
import { callableChat, streamChat } from '../aiChatTransport';

let lastBody = '';

function emptyStream() {
  return new Response(
    new ReadableStream<Uint8Array>({ start(c) { c.close(); } }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

describe('Q-3: флаг crisis в транспорте', () => {
  beforeEach(() => {
    lastBody = '';
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: string }) => {
      lastBody = init?.body ?? '';
      return emptyStream();
    }));
  });

  it('поток: в теле запроса к /api/chat есть "crisis":true', async () => {
    await streamChat({
      personaId: 'cbt',
      messages: [{ role: 'user', content: 'не хочу жить' }],
      crisis: true,
      onChunk: () => {},
    });
    expect(JSON.parse(lastBody)).toMatchObject({ crisis: true });
  });

  it('поток без кризиса: поля в теле нет', async () => {
    await streamChat({
      personaId: 'cbt',
      messages: [{ role: 'user', content: 'привет' }],
      onChunk: () => {},
    });
    expect(JSON.parse(lastBody).crisis).toBeUndefined();
  });

  it('callable-путь передаёт флаг в AIService.chat', async () => {
    const spy = vi.spyOn(AIService, 'chat').mockResolvedValue({ ok: true, text: 'рядом' });
    await callableChat({
      personaId: 'cbt',
      messages: [{ role: 'user', content: 'не хочу жить' }],
      crisis: true,
    });
    expect(spy.mock.calls[0]![0]).toMatchObject({ crisis: true });
    spy.mockRestore();
  });
});
